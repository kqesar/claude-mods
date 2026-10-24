# Source it from ~/.bashrc or ~/.zshrc (the same syntax serves both).
#
# Wraps `claude` so that the hot-upgrade mod (github.com/kqesar/claude-mods) can
# switch versions without losing the session: the mod installs the new
# version, writes the session id to $CLAUDE_RELAUNCH_FILE and exits at a safe
# point; this loop then resumes that session on the new binary. Without the
# mod the file stays empty and claude runs exactly as before.
claude() {
	local file id rc
	file=$(mktemp -t claude-relaunch.XXXXXX) || {
		command claude "$@"
		return
	}
	CLAUDE_RELAUNCH_FILE=$file command claude "$@"
	rc=$?
	while [ -s "$file" ]; do
		id=$(cat "$file")
		: >"$file"
		CLAUDE_RELAUNCH_FILE=$file command claude --resume "$id"
		rc=$?
	done
	rm -f "$file"
	return "$rc"
}
