# Wraps `claude` so that the hot-upgrade mod (github.com/kqesar/claude-mods) can
# switch versions without losing the session: the mod installs the new
# version, writes the session id to $CLAUDE_RELAUNCH_FILE and exits at a safe
# point; this loop then resumes that session on the new binary. Without the
# mod the file stays empty and claude runs exactly as before. Copy it to
# ~/.config/fish/functions/; the bash/zsh twin is claude.sh.
function claude --description 'Claude Code, resumed on the same session after /hot-upgrade'
    set -l file (mktemp -t claude-relaunch.XXXXXX)
    or begin
        command claude $argv
        return
    end
    CLAUDE_RELAUNCH_FILE=$file command claude $argv
    set -l rc $status
    while test -s $file
        set -l id (cat $file)
        true >$file
        CLAUDE_RELAUNCH_FILE=$file command claude --resume $id
        set rc $status
    end
    rm -f $file
    return $rc
end
