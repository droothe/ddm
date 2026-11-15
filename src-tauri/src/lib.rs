use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::{
    header::{self, HeaderValue},
    Client, Response, StatusCode,
};
use serde::Serialize;
use tauri::Manager;
use tauri::{Emitter, State};
use tauri_plugin_notification::NotificationExt;
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
    sync::Mutex as AsyncMutex,
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

const PROGRESS_EVENT: &str = "download-progress";

#[derive(Clone)]
struct DownloadManager {
    jobs: Arc<Mutex<HashMap<String, DownloadControl>>>,
    client: Client,
    rate_limiter: RateLimiter,
}

fn resolve_download_destination(value: &str, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let relative = Path::new(value);
        if relative.is_absolute() {
            return Err("Android downloads must use an app-relative destination.".to_owned());
        }
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not find app storage: {error}"))?;
        let mut destination = root;
        for component in relative.components() {
            match component {
                std::path::Component::Normal(part) => destination.push(part),
                std::path::Component::CurDir => {}
                _ => return Err("The Android download path is invalid.".to_owned()),
            }
        }
        Ok(destination)
    }
    #[cfg(not(target_os = "android"))]
    {
        if value.trim().is_empty() {
            app.path()
                .download_dir()
                .map_err(|error| format!("Could not find the system Downloads directory: {error}"))
        } else {
            resolve_destination(value)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectMedia {
    url: String,
    name: String,
    mime_type: String,
}

#[derive(Clone)]
struct DownloadControl {
    cancel: CancellationToken,
    paused: watch::Sender<bool>,
    rate_limiter: RateLimiter,
}

#[tauri::command]
async fn extract_media_url(
    url: String,
    manager: State<'_, DownloadManager>,
) -> Result<DirectMedia, String> {
    let parsed = validated_url(&url)?;
    if is_social_platform_host(parsed.host_str().unwrap_or_default()) {
        return Err(
            "Social-platform page extraction is not supported. Provide a direct media URL you are authorized to download."
                .to_owned(),
        );
    }

    let response = manager
        .client
        .head(parsed.clone())
        .send()
        .await
        .map_err(|error| format!("Could not inspect the shared media URL: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The media server rejected the preview request (HTTP {}).",
            response.status()
        ));
    }
    let final_url = response.url().clone();
    if is_social_platform_host(final_url.host_str().unwrap_or_default()) {
        return Err("Redirected social-platform pages cannot be extracted.".to_owned());
    }
    let mime_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if mime_type == "text/html" || mime_type == "application/xhtml+xml" {
        return Err("The shared link is a web page, not a direct media file.".to_owned());
    }

    let metadata = probe_url(&manager.client, final_url.as_str()).await?;
    let extension = metadata
        .extension
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let supported_extension = matches!(
        extension.as_str(),
        "mp4" | "m4v" | "mov" | "webm" | "mp3" | "m4a" | "wav" | "ogg" | "flac"
    );
    if !mime_type.starts_with("video/") && !mime_type.starts_with("audio/") && !supported_extension
    {
        return Err("The shared URL does not point to a direct audio or video file.".to_owned());
    }

    Ok(DirectMedia {
        url: final_url.to_string(),
        name: metadata.name,
        mime_type,
    })
}

#[derive(Clone)]
struct RateLimiter {
    bytes_per_second: Arc<AtomicU64>,
    next_allowed: Arc<AsyncMutex<Instant>>,
}

impl RateLimiter {
    fn new(bytes_per_second: u64) -> Self {
        Self {
            bytes_per_second: Arc::new(AtomicU64::new(bytes_per_second)),
            next_allowed: Arc::new(AsyncMutex::new(Instant::now())),
        }
    }

    fn set_limit(&self, bytes_per_second: u64) {
        self.bytes_per_second
            .store(bytes_per_second, Ordering::Relaxed);
    }

    async fn wait(&self, byte_count: usize, cancel: &CancellationToken) -> Result<bool, String> {
        let bytes_per_second = self.bytes_per_second.load(Ordering::Relaxed);
        if bytes_per_second == 0 {
            return Ok(true);
        }

        let now = Instant::now();
        let delay = {
            let mut next_allowed = self.next_allowed.lock().await;
            let delay = next_allowed.saturating_duration_since(now);
            let seconds = byte_count as f64 / bytes_per_second as f64;
            *next_allowed = now.max(*next_allowed) + std::time::Duration::from_secs_f64(seconds);
            delay
        };
        tokio::select! {
            _ = cancel.cancelled() => Ok(false),
            _ = tokio::time::sleep(delay) => Ok(true),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadMetadata {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    size: u64,
    supports_ranges: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSegment {
    start: u64,
    end: u64,
    size: u64,
    done: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    status: String,
    size: u64,
    speed: u64,
    chunks: Vec<ThreadSegment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        let client = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .user_agent(concat!("DDM/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("failed to construct the HTTP client");
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            client,
            rate_limiter: RateLimiter::new(0),
        }
    }
}

impl DownloadManager {
    fn insert(&self, id: String, control: DownloadControl) -> Result<(), String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "Download manager lock was poisoned.".to_owned())?;
        if jobs.contains_key(&id) {
            return Err("A download with this ID is already active.".to_owned());
        }
        jobs.insert(id, control);
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Option<DownloadControl>, String> {
        self.jobs
            .lock()
            .map(|jobs| jobs.get(id).cloned())
            .map_err(|_| "Download manager lock was poisoned.".to_owned())
    }

    fn remove(&self, id: &str) {
        match self.jobs.lock() {
            Ok(mut jobs) => {
                jobs.remove(id);
            }
            Err(error) => eprintln!("Could not remove download {id}: {error}"),
        }
    }
}

#[tauri::command]
async fn check_url_headers(
    url: String,
    manager: State<'_, DownloadManager>,
) -> Result<DownloadMetadata, String> {
    probe_url(&manager.client, &url).await
}

#[tauri::command(rename_all = "camelCase")]
async fn start_download(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    url: String,
    save_path: String,
    target_path: Option<String>,
    thread_count: u8,
    download_id: String,
    speed_limit_bytes_per_second: u64,
) -> Result<(), String> {
    if !(1..=16).contains(&thread_count) {
        return Err("Thread count must be between 1 and 16.".to_owned());
    }
    if download_id.is_empty() || download_id.len() > 128 {
        return Err("Download ID is invalid.".to_owned());
    }
    let selected_target = target_path
        .filter(|path| !path.trim().is_empty())
        .map(|path| {
            let selected_path = PathBuf::from(path);
            if !selected_path.is_absolute() {
                return Err("The selected download path must be absolute.".to_owned());
            }
            let parent = selected_path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| "The selected download path has no parent directory.".to_owned())?
                .to_path_buf();
            let name = selected_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(safe_file_name)
                .ok_or_else(|| "The selected download path has no valid file name.".to_owned())?;
            let selected_path = parent.join(&name);
            Ok((parent, selected_path, name))
        })
        .transpose()?;
    let destination_dir = match &selected_target {
        Some((parent, _, _)) => parent.clone(),
        None => resolve_download_destination(&save_path, &app)?,
    };
    if destination_dir.as_os_str().is_empty() {
        return Err("A destination directory is required.".to_owned());
    }

    let mut metadata = probe_url(&manager.client, &url).await?;
    if let Some((_, _, name)) = &selected_target {
        metadata.name = name.clone();
    }
    fs::create_dir_all(&destination_dir)
        .await
        .map_err(|error| format!("Could not create the destination directory: {error}"))?;

    let file_path = selected_target
        .map(|(_, selected_path, _)| selected_path)
        .unwrap_or_else(|| destination_dir.join(&metadata.name));
    let segment_count = if metadata.supports_ranges {
        thread_count as usize
    } else {
        1
    };
    let segments = split_ranges(metadata.size, segment_count)?;
    let job_uuid = Uuid::new_v4();
    let part_paths: Vec<PathBuf> = (0..segments.len())
        .map(|index| {
            destination_dir.join(format!(".{}.ddm-{job_uuid}.part-{index}", metadata.name))
        })
        .collect();
    let merge_path = destination_dir.join(format!(".{}.ddm-{job_uuid}.merge", metadata.name));

    let (paused, _) = watch::channel(false);
    manager.rate_limiter.set_limit(speed_limit_bytes_per_second);
    let control = DownloadControl {
        cancel: CancellationToken::new(),
        paused,
        rate_limiter: manager.rate_limiter.clone(),
    };
    manager.insert(download_id.clone(), control.clone())?;

    let manager = manager.inner().clone();
    let client = manager.client.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_download(
            &app,
            &client,
            &download_id,
            &url,
            &metadata,
            segments,
            part_paths.clone(),
            &file_path,
            &merge_path,
            control.clone(),
        )
        .await;

        if let Err(error) = result {
            let cancelled = control.cancel.is_cancelled();
            if cancelled {
                remove_files(&part_paths, &merge_path).await;
            } else {
                let progress = DownloadProgress {
                    id: download_id.clone(),
                    status: "error".to_owned(),
                    size: metadata.size,
                    speed: 0,
                    chunks: Vec::new(),
                    error_message: Some(error.clone()),
                    file_path: None,
                };
                if let Err(emit_error) = app.emit(PROGRESS_EVENT, progress) {
                    eprintln!("Could not emit download error for {download_id}: {emit_error}");
                }
                remove_files(&part_paths, &merge_path).await;
            }
        }
        manager.remove(&download_id);
    });

    Ok(())
}

#[tauri::command]
async fn pause_download(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let control = manager
        .get(&id)?
        .ok_or_else(|| "Download is not active.".to_owned())?;
    control.paused.send_replace(true);
    app.emit(PROGRESS_EVENT, basic_progress(&id, "paused", 0, Vec::new()))
        .map_err(|error| format!("Could not notify the frontend: {error}"))
}

#[tauri::command]
async fn resume_download(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let control = manager
        .get(&id)?
        .ok_or_else(|| "Download is not active.".to_owned())?;
    control.paused.send_replace(false);
    app.emit(
        PROGRESS_EVENT,
        basic_progress(&id, "downloading", 0, Vec::new()),
    )
    .map_err(|error| format!("Could not notify the frontend: {error}"))
}

#[tauri::command]
async fn cancel_download(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    if let Some(control) = manager.get(&id)? {
        control.cancel.cancel();
    }
    app.emit(
        PROGRESS_EVENT,
        basic_progress(&id, "cancelled", 0, Vec::new()),
    )
    .map_err(|error| format!("Could not notify the frontend: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
async fn show_download_in_folder(
    path: String,
    name: String,
    target_path: Option<String>,
) -> Result<(), String> {
    let file_path = match target_path {
        Some(path) if Path::new(&path).is_absolute() => PathBuf::from(path),
        Some(_) => return Err("The selected download path must be absolute.".to_owned()),
        None => resolve_destination(&path)?.join(safe_file_name(&name)),
    };
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer.exe")
        .arg("/select,")
        .arg(&file_path)
        .spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(&file_path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open")
        .arg(file_path.parent().unwrap_or(Path::new(".")))
        .spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("Could not open the download location: {error}"))
}

#[tauri::command]
fn default_download_directory(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .download_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("Could not find the system Downloads directory: {error}"))
}

fn basic_progress(
    id: &str,
    status: &str,
    size: u64,
    chunks: Vec<ThreadSegment>,
) -> DownloadProgress {
    DownloadProgress {
        id: id.to_owned(),
        status: status.to_owned(),
        size,
        speed: 0,
        chunks,
        error_message: None,
        file_path: None,
    }
}

async fn probe_url(client: &Client, raw_url: &str) -> Result<DownloadMetadata, String> {
    let url = validated_url(raw_url)?;
    let head = client.head(url.clone()).send().await.ok();
    let head_name = head
        .as_ref()
        .map(|response| response_name(response, &url))
        .unwrap_or_else(|| file_name_from_url(&url));
    let mut size = head
        .as_ref()
        .and_then(|response| response.content_length())
        .filter(|value| *value > 0);
    let advertised_ranges = head
        .as_ref()
        .and_then(|response| response.headers().get(header::ACCEPT_RANGES))
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("bytes"));

    let response = client
        .get(url.clone())
        .header(header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|error| format!("Could not inspect the download URL: {error}"))?;
    let response_has_name = response.headers().contains_key(header::CONTENT_DISPOSITION);
    let response_file_name = response_name(&response, &url);
    let name = if response_has_name {
        response_file_name
    } else {
        head_name
    };
    let supports_ranges = response.status() == StatusCode::PARTIAL_CONTENT;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if content_type == "text/html" || content_type == "application/xhtml+xml" {
        return Err("The URL resolved to a web page, not a downloadable file.".to_owned());
    }
    if supports_ranges {
        let content_range = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_content_range);
        if !matches!(content_range, Some((0, 0, total)) if total > 0) {
            return Err("The server returned an invalid Content-Range for the probe.".to_owned());
        }
        size = content_range.map(|(_, _, total)| total).or(size);
    } else if response.status().is_success() {
        size = response
            .content_length()
            .filter(|value| *value > 0)
            .or(size);
        if advertised_ranges {
            eprintln!("Server advertised Accept-Ranges but ignored the byte-range probe: {url}");
        }
    } else {
        return Err(format!(
            "Server rejected URL probe with HTTP {}.",
            response.status()
        ));
    }
    drop(response);

    let size = size.ok_or_else(|| {
        "The server did not provide a valid Content-Length or Content-Range.".to_owned()
    })?;
    if size == 0 {
        return Err("The URL points to an empty file.".to_owned());
    }
    let name = safe_file_name(&name);
    Ok(DownloadMetadata {
        extension: Path::new(&name)
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase()),
        mime_type: (!content_type.is_empty()).then_some(content_type),
        name,
        size,
        supports_ranges,
    })
}

fn validated_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid download URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS download URLs are supported.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing embedded credentials are not supported.".to_owned());
    }
    Ok(url)
}

fn is_social_platform_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    [
        "instagram.com",
        "tiktok.com",
        "youtube.com",
        "youtu.be",
        "x.com",
        "twitter.com",
    ]
    .iter()
    .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn resolve_destination(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Ok(path);
    }

    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "Could not determine the current user's home directory.".to_owned())?;
    Ok(PathBuf::from(home).join(path))
}

fn response_name(response: &Response, url: &Url) -> String {
    if let Some(disposition) = response
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
    {
        if let Some(value) = disposition
            .split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix("filename*=UTF-8''"))
        {
            return safe_file_name(&percent_decode_str(value).decode_utf8_lossy());
        }
        if let Some(value) = disposition
            .split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix("filename="))
        {
            return safe_file_name(value.trim_matches('"'));
        }
    }
    file_name_from_url(url)
}

fn file_name_from_url(url: &Url) -> String {
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|segment| !segment.is_empty())
        .map(|segment| safe_file_name(&percent_decode_str(segment).decode_utf8_lossy()))
        .unwrap_or_else(|| url.host_str().unwrap_or("download.bin").to_owned())
}

fn safe_file_name(value: &str) -> String {
    let leaf = value
        .trim()
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or_default()
        .trim();
    if leaf.is_empty() || leaf == "." || leaf == ".." || leaf.chars().any(char::is_control) {
        "download.bin".to_owned()
    } else {
        leaf.to_owned()
    }
}

fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}

fn split_ranges(size: u64, thread_count: usize) -> Result<Vec<ThreadSegment>, String> {
    if size == 0 {
        return Err("Cannot split an empty file into byte ranges.".to_owned());
    }
    if !(1..=16).contains(&thread_count) {
        return Err("Thread count must be between 1 and 16.".to_owned());
    }

    let count = thread_count.min(size.min(16) as usize);
    let base = size / count as u64;
    let mut start = 0;
    let mut segments = Vec::with_capacity(count);
    for index in 0..count {
        let length = if index + 1 == count {
            size - start
        } else {
            base
        };
        segments.push(ThreadSegment {
            start,
            end: start + length - 1,
            size: length,
            done: 0,
        });
        start += length;
    }
    Ok(segments)
}

async fn run_download(
    app: &tauri::AppHandle,
    client: &Client,
    id: &str,
    url: &str,
    metadata: &DownloadMetadata,
    segments: Vec<ThreadSegment>,
    part_paths: Vec<PathBuf>,
    file_path: &Path,
    merge_path: &Path,
    control: DownloadControl,
) -> Result<(), String> {
    emit_download_progress(
        app,
        id,
        "downloading",
        metadata.size,
        0,
        &segments,
        None,
        None,
    )?;

    let completed = Arc::new(
        segments
            .iter()
            .map(|_| AtomicU64::new(0))
            .collect::<Vec<_>>(),
    );
    let mut tasks = JoinSet::new();
    for (index, segment) in segments.iter().cloned().enumerate() {
        let client = client.clone();
        let app = app.clone();
        let url = url.to_owned();
        let id = id.to_owned();
        let metadata = metadata.clone();
        let part_path = part_paths[index].clone();
        let control = control.clone();
        let all_segments = segments.clone();
        let completed = completed.clone();
        tasks.spawn(async move {
            download_segment(
                &app,
                &client,
                &id,
                &url,
                &metadata,
                segment,
                part_path,
                all_segments,
                index,
                completed,
                control,
            )
            .await
        });
    }

    while let Some(result) = tasks.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                control.cancel.cancel();
                while tasks.join_next().await.is_some() {}
                return Err(error);
            }
            Err(error) => {
                control.cancel.cancel();
                while tasks.join_next().await.is_some() {}
                return Err(format!("Download worker failed: {error}"));
            }
        }
    }

    if control.cancel.is_cancelled() {
        return Err("Download cancelled.".to_owned());
    }
    emit_download_progress(app, id, "merging", metadata.size, 0, &segments, None, None)?;
    tokio::select! {
        _ = control.cancel.cancelled() => return Err("Download cancelled.".to_owned()),
        result = merge_parts(&part_paths, merge_path, file_path, metadata.size) => result?,
    }
    remove_files(&part_paths, merge_path).await;
    emit_download_progress(
        app,
        id,
        "completed",
        metadata.size,
        0,
        &segments
            .iter()
            .map(|segment| ThreadSegment {
                done: segment.size,
                ..segment.clone()
            })
            .collect::<Vec<_>>(),
        None,
        Some(file_path),
    )?;
    if let Err(error) = app
        .notification()
        .builder()
        .title("İndirme Tamamlandı")
        .body(&metadata.name)
        .show()
    {
        eprintln!("Could not show completion notification for {id}: {error}");
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn download_segment(
    app: &tauri::AppHandle,
    client: &Client,
    id: &str,
    url: &str,
    metadata: &DownloadMetadata,
    mut segment: ThreadSegment,
    part_path: PathBuf,
    all_segments: Vec<ThreadSegment>,
    index: usize,
    completed: Arc<Vec<AtomicU64>>,
    control: DownloadControl,
) -> Result<(), String> {
    let mut pause_receiver = control.paused.subscribe();
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part_path)
        .await
        .map_err(|error| format!("Could not create a temporary chunk file: {error}"))?;
    let existing = output
        .metadata()
        .await
        .map_err(|error| format!("Could not inspect a temporary chunk file: {error}"))?
        .len();
    if existing > segment.size {
        output
            .set_len(0)
            .await
            .map_err(|error| format!("Could not reset an invalid temporary chunk: {error}"))?;
    } else {
        segment.done = existing;
    }
    completed[index].store(segment.done, Ordering::Relaxed);

    let mut last_reported = segment.done;
    let mut last_report_time = Instant::now();
    while segment.done < segment.size {
        if !wait_until_resumed(&mut pause_receiver, &control.cancel).await? {
            return Ok(());
        }

        let range_start = segment.start + segment.done;
        let mut request = client.get(url);
        if metadata.supports_ranges {
            let range = HeaderValue::from_str(&format!("bytes={range_start}-{}", segment.end))
                .map_err(|error| format!("Invalid HTTP byte range: {error}"))?;
            request = request.header(header::RANGE, range);
        }

        let response = tokio::select! {
            _ = control.cancel.cancelled() => return Ok(()),
            result = request.send() => result.map_err(|error| format!("Chunk request failed: {error}"))?,
        };
        if !response.status().is_success() {
            return Err(format!(
                "Chunk request failed with HTTP {}.",
                response.status()
            ));
        }
        if metadata.supports_ranges && response.status() != StatusCode::PARTIAL_CONTENT {
            return Err("The server stopped honoring HTTP Range requests.".to_owned());
        }
        if !metadata.supports_ranges && response.status() == StatusCode::PARTIAL_CONTENT {
            return Err("The server returned a partial response without range support.".to_owned());
        }
        if metadata.supports_ranges {
            let content_range = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(parse_content_range);
            if content_range != Some((range_start, segment.end, metadata.size)) {
                return Err("The server returned an unexpected HTTP Content-Range.".to_owned());
            }
        }

        let mut stream = response.bytes_stream();
        let mut paused_mid_stream = false;
        loop {
            tokio::select! {
                _ = control.cancel.cancelled() => return Ok(()),
                changed = pause_receiver.changed() => {
                    if changed.is_err() {
                        return Err("Download pause channel closed unexpectedly.".to_owned());
                    }
                    if *pause_receiver.borrow() {
                        paused_mid_stream = true;
                        break;
                    }
                }
                item = stream.next() => {
                    let Some(item) = item else { break };
                    let bytes = item.map_err(|error| format!("Could not read a download chunk: {error}"))?;
                    if !control
                        .rate_limiter
                        .wait(bytes.len(), &control.cancel)
                        .await?
                    {
                        return Ok(());
                    }
                    if !wait_until_resumed(&mut pause_receiver, &control.cancel).await? {
                        return Ok(());
                    }
                    if segment.done + bytes.len() as u64 > segment.size {
                        return Err("The server sent more data than the requested byte range.".to_owned());
                    }
                    output
                        .write_all(&bytes)
                        .await
                        .map_err(|error| format!("Could not write a download chunk: {error}"))?;
                    segment.done += bytes.len() as u64;
                    completed[index].store(segment.done, Ordering::Relaxed);

                    let elapsed = last_report_time.elapsed().as_secs_f64().max(0.001);
                    let speed = ((segment.done - last_reported) as f64 / elapsed) as u64;
                    last_reported = segment.done;
                    last_report_time = Instant::now();
                    let current = all_segments
                        .iter()
                        .enumerate()
                        .map(|(chunk_index, chunk)| ThreadSegment {
                            done: completed[chunk_index].load(Ordering::Relaxed),
                            ..chunk.clone()
                        })
                        .collect::<Vec<_>>();
                    emit_download_progress(
                        app,
                        id,
                        "downloading",
                        metadata.size,
                        speed,
                        &current,
                        None,
                        None,
                    )?;
                }
            }
        }
        if !paused_mid_stream && segment.done < segment.size {
            return Err(
                "The server ended a chunk before the requested byte range was complete.".to_owned(),
            );
        }
    }

    output
        .flush()
        .await
        .map_err(|error| format!("Could not flush a download chunk: {error}"))?;
    Ok(())
}

async fn wait_until_resumed(
    paused: &mut watch::Receiver<bool>,
    cancel: &CancellationToken,
) -> Result<bool, String> {
    loop {
        if !*paused.borrow() {
            return Ok(true);
        }
        tokio::select! {
            _ = cancel.cancelled() => return Ok(false),
            changed = paused.changed() => {
                if changed.is_err() {
                    return Err("Download pause channel closed unexpectedly.".to_owned());
                }
            }
        }
    }
}

fn emit_download_progress(
    app: &tauri::AppHandle,
    id: &str,
    status: &str,
    size: u64,
    speed: u64,
    chunks: &[ThreadSegment],
    error_message: Option<String>,
    file_path: Option<&Path>,
) -> Result<(), String> {
    app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            id: id.to_owned(),
            status: status.to_owned(),
            size,
            speed,
            chunks: chunks.to_vec(),
            error_message,
            file_path: file_path.map(|path| path.to_string_lossy().into_owned()),
        },
    )
    .map_err(|error| format!("Could not emit download progress: {error}"))
}

async fn merge_parts(
    part_paths: &[PathBuf],
    merge_path: &Path,
    destination: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let mut merged = File::create(merge_path)
        .await
        .map_err(|error| format!("Could not create the merged file: {error}"))?;
    let mut total = 0;
    let mut buffer = vec![0_u8; 64 * 1024];
    for path in part_paths {
        let mut part = File::open(path)
            .await
            .map_err(|error| format!("Could not open a completed chunk: {error}"))?;
        loop {
            let read = part
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Could not read a completed chunk: {error}"))?;
            if read == 0 {
                break;
            }
            merged
                .write_all(&buffer[..read])
                .await
                .map_err(|error| format!("Could not merge a completed chunk: {error}"))?;
            total += read as u64;
        }
    }
    if total != expected_size {
        return Err(format!(
            "Merged file size mismatch: expected {expected_size} bytes, got {total}."
        ));
    }
    merged
        .flush()
        .await
        .map_err(|error| format!("Could not flush the merged file: {error}"))?;
    drop(merged);

    let destination_exists = fs::try_exists(destination)
        .await
        .map_err(|error| format!("Could not inspect the destination file: {error}"))?;
    if destination_exists {
        fs::remove_file(destination)
            .await
            .map_err(|error| format!("Could not replace the existing destination file: {error}"))?;
    }
    fs::rename(merge_path, destination)
        .await
        .map_err(|error| format!("Could not finalize the downloaded file: {error}"))
}

async fn remove_files(parts: &[PathBuf], merge_path: &Path) {
    for path in parts {
        if let Err(error) = fs::remove_file(path).await {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "Could not remove temporary download file {}: {error}",
                    path.display()
                );
            }
        }
    }
    if let Err(error) = fs::remove_file(merge_path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "Could not remove temporary download file {}: {error}",
                merge_path.display()
            );
        }
    }
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.set_focus() {
                    eprintln!("Could not focus the existing DDM window: {error}");
                }
            }
        }));
    }

    builder
        .manage(DownloadManager::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("share-intent")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    _api.register_android_plugin("dev.droothe.ddm", "ShareIntentPlugin")?;
                    Ok(())
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_download_directory,
            check_url_headers,
            extract_media_url,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            show_download_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Droothe Download Manager");
}

#[cfg(test)]
mod tests {
    use super::{safe_file_name, split_ranges};

    #[test]
    fn splits_ranges_without_gaps_or_overlap() {
        let ranges = split_ranges(10, 3).expect("range split should succeed");
        assert_eq!(
            ranges
                .iter()
                .map(|range| (range.start, range.end, range.size))
                .collect::<Vec<_>>(),
            vec![(0, 2, 3), (3, 5, 3), (6, 9, 4)]
        );
    }

    #[test]
    fn limits_ranges_to_file_size() {
        let ranges = split_ranges(2, 16).expect("range split should succeed");
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[1].end, 1);
    }

    #[test]
    fn sanitizes_download_names() {
        assert_eq!(safe_file_name("../../file.zip"), "file.zip");
        assert_eq!(safe_file_name(".."), "download.bin");
    }
}
