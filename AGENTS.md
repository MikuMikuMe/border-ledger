## CodeScene

- For each supported source file you modify in a repository, run the CodeScene `code_health_review` tool after the change and address maintainability regressions within scope.
- After fixing a Code Health regression, rerun `code_health_review` and use `code_health_score` to confirm the result.
- Before saying repository changes are ready to commit or initiating a commit, run `pre_commit_code_health_safeguard` for the repository's staged and modified files. Resolve degradations where practical; disclose any unresolved findings and never describe a failed gate as passing.
- Before saying a branch is ready for a pull request, run `analyze_change_set` against the pull request's base ref. Determine the base from the repository; ask if it is ambiguous.
- Skip per-file checks for non-code changes and unsupported or generated files. If CodeScene is unavailable, authentication fails, or the workspace is not a Git repository, say the check could not run.
- Use CodeScene project analytics only when relevant, and select the project before calling project-scoped tools.
- Follow a user's request to skip or defer a CodeScene check for a particular task.
