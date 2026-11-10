<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Shared visible task status

- When a task reaches a clear outcome, use the VS Code integrated browser when available to show a full-viewport status: green for success, red for an error, and blue when waiting for the user's answer.
- Keep the status visible until the user responds; do not dismiss it with a timer. If an error is fixed, replace red with green.
- For questions, also use the normal chat question flow. If no integrated browser is available, report the status in chat and do not claim a screen was shown.
- Do not claim access to the user's external browser or imply background monitoring. See `../otomasyon.md`.
