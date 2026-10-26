# Retained keyboard diagnostic

The archived source ran against synthetic run `704fa285e6e344d5955c4e93` at its original path `tests/phase2/deposit-keyboard-probe.spec.ts`. It compared the application select with a plain native select using the same keys. Both retained the empty option, with trusted unprevented key events and no input or change event.

This fixed-fixture census is diagnostic evidence, not an acceptance case. Its source is archived outside default test discovery so future fresh runs do not carry a skipped historical fixture. Reproduction requires the retained private plan, original synthetic database and original source path. The public log is in `../raw/704fa285e6e344d5955c4e93-keyboard-probe-a71a4ed6-149e-4040-943c-6b78ed717b42.log`.

The subsequent acceptance case uses the supported Playwright native selection operation, then checks keyboard focus, checkbox and form submission, exact financial results and Axe. Native-popup option navigation by keyboard is not established by this browser runner.
