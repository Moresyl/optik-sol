# Security Policy

English | [简体中文](SECURITY.zh-CN.md)

## Supported versions

The project is still in 0.x; security fixes are provided for the **latest released version** only.

## Reporting a vulnerability

**Please do not report security issues through public issues.**

Prefer GitHub's [private vulnerability reporting](https://github.com/Moresyl/optik-sol/security/advisories/new), or email **xd@biekanle.com**. Where possible, include the affected version and integration method, reproduction steps (ideally a minimal reproducible page), and your assessment of the impact.

We acknowledge reports within **72 hours** and credit reporters in the release notes once a fix ships, unless you prefer to stay anonymous.

## Threat model

The following three points are **by design** and are not vulnerabilities:

- **Optik Sol reads sensitive data from the page.** It records request headers (including `Authorization` and `Cookie`), request bodies, response bodies, localStorage and cookies, displays them in the panel and allows them to be copied out. That is a debugger's job.
- **Optik Sol patches the page.** It replaces `console` methods, `XMLHttpRequest`, `fetch`, `navigator.sendBeacon`, `WebSocket` and `EventSource`, and listens for global errors. Every replacement passes through to the original implementation, and `destroy()` restores each one from its original property descriptor.
- **The panel is reachable by any script on the page** (`window.Optik`). It has no privilege boundary and is not intended to have one.

From which follows the single mandatory requirement:

> **Do not mount Optik Sol unconditionally in production.** Gate it behind an environment variable, a build-time constant, or some other switch.

What does count as a vulnerability is the panel **itself** introducing attack surface the page did not already have:

- XSS in the rendering of logs or response bodies (everything inside the panel should render as text, never as parsed HTML)
- Instrumentation leaking host data to a third party on an error path
- Hooks or references surviving after `destroy()`
- The panel weakening the host page's CSP

Please do report these.
