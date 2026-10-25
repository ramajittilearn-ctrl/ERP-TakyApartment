# Observe early HTTP size rejection without racing an upload

The validator checks declared Content-Length before creating a temporary file or invoking a parser. It may send413 with Connection:close while an oversized caller is still transmitting. Fetch can then report a transport failure while writing that unnecessary body instead of returning the already-issued HTTP response. The prior fixture sent a5MiB+1 Buffer through Fetch to prove a header-only decision, creating a transport race unrelated to the byte-limit policy.

The declared-size fixture now uses node:http to flush only the declared oversized header, consumes the server response, requires413 and confirms no parser/file work. It sends no body. The separate existing streamed-size case remains unchanged and sends actual chunked MAX_BYTES+1 bytes, requiring413, no parser acceptance and cleaned temporary inputs. The production5MiB limit, rejection logic, connection policy and parser bounds are unchanged.

This commit also retains Root’s preexisting Host header correction for the duplicate-credential fixture. That change was already present in the worktree and was inspected before editing. No runtime evidence JSON or unrelated source was staged.

Syntax/format/source whitespace checks ran locally. Native HTTP tests require Root’s permitted loopback execution and remain pending after this test-only correction. No validator production source or resource boundary changed.
