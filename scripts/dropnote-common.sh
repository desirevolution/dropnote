# Shared request handling for dropnote-text and dropnote-file.

fail() {
    printf '%s: %s\n' "${0##*/}" "$*" >&2
    exit 2
}

validate_header() {
    case $2 in
        *[[:cntrl:]]*) fail "$1 cannot contain control characters." ;;
    esac
}

send_to_dropnote() {
    action=$1
    expected=$2
    shift 2

    case ${DROPNOTE:-} in
        http://?*|https://?*) ;;
        *) fail 'Set DROPNOTE to the internal Dropnote URL, for example https://dropnote.example.com.' ;;
    esac
    case $DROPNOTE in
        *[[:space:][:cntrl:]]*|*\?*|*\#*|*@*) fail 'DROPNOTE must be a URL without credentials, query or fragment.' ;;
    esac
    case $space in
        ''|*[!abcdefghijklmnopqrstuvwxyz0123456789-]*|-*|*-|*--*)
            fail 'Use a space URL slug with lowercase letters, digits and single hyphens.'
            ;;
    esac
    [ "${#space}" -le 63 ] || fail 'The space URL slug must be at most 63 characters.'
    validate_header 'Display name' "$display_name"
    command -v curl >/dev/null 2>&1 || fail 'curl is required.'

    if [ -n "$display_name" ]; then
        set -- -H "X-Space-Name: $display_name" "$@"
    fi

    # Read the HTTP status even on errors. In particular, an SSO redirect
    # is not a successful append.
    newline='
'
    if reply=$(curl -q --silent --show-error --fail-with-body --globoff \
        --write-out '\n%{http_code}' "$@" -- "${DROPNOTE%/}/api/pads/$space/script/$action"); then
        code=0
    else
        code=$?
    fi
    status=${reply##*"$newline"}
    if [ "$code" -eq 0 ] && [ "$status" = "$expected" ]; then
        return 0
    fi
    body=${reply%"$newline"*}
    [ -z "$body" ] || printf '%s\n' "$body" >&2
    case $status in
        3[0-9][0-9]) printf '%s: HTTP %s. Check the internal URL and proxy login.\n' "${0##*/}" "$status" >&2 ;;
        [1-5][0-9][0-9]) printf '%s: HTTP %s.\n' "${0##*/}" "$status" >&2 ;;
    esac
    [ "$code" -ne 0 ] || code=1
    return "$code"
}
