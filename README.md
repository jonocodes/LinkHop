# LinkHop

LinkHop is a lightweight, self-hosted tool for passing messages between your own devices.

It is designed for quick, reliable handoff — not storage, sync, or long-term history.

---

## Motivation

Modern tools for sending content between devices tend to be:

* unreliable if the target device is offline
* tied to a specific ecosystem
* overly complex or cloud-dependent
* focused on sync rather than handoff

I personally love the experience of sending links between my Firefox browsers — it is simple, fast, and feels natural. But it breaks down when a device is offline, and it is limited in flexibility.

LinkHop is built to capture that same simplicity, while fixing the reliability and control issues.

> "I want to send something from one of my devices to another, and have it show up when that device is ready."

It prioritizes:

* reliability over immediacy
* simplicity over features
* ownership over cloud dependency

---

## Goals

### Primary goal

Make it easy to send a URL or text message from one device to another, even if the receiving device is offline.

### Core principles

* **Ephemeral** — messages are not meant to be stored long-term
* **Device-to-device** — everything is addressed to your own devices
* **Self-hosted** — you control where it runs
* **Queue-based** — delivery is reliable, not just best-effort realtime
* **Extension-optional** — works fully in a normal browser

---

## What LinkHop is (and isn’t)

### It is:

* a personal message relay between your devices
* a way to "pass" links or notes across contexts
* a small, focused tool

### It is not:

* a chat system
* a file sync system
* a bookmark manager
* a long-term message archive

---

## Example use cases

* Send a link from your phone to your desktop
* Pass a note or snippet between machines
* Queue something to open later when a device comes online
* Move context between work and personal environments

---

## High-level design

LinkHop uses a simple model:

* Devices are registered endpoints
* Messages are sent between devices
* The server queues messages until they are delivered
* Devices receive realtime notifications when online

Delivery is:

* reliable (queue-backed)
* simple (HTTP + SSE)

---

## Current status

🚧 Early development

This project is being built as a minimal, self-hosted tool with a strong focus on simplicity and correctness.

---

## Future directions

Planned areas of expansion include:

* Browser extension for faster sending
* Mobile-friendly experience and notifications
* CLI for terminal-based usage
* Exploration of **LinkHopMesh**, a decentralized peer-to-peer version where devices can relay messages for each other without requiring a central server

---

## License

GPL v3

---

## Contributing

TBD

---

## Summary

LinkHop is built around a simple idea:

> Your devices should be able to pass things to each other reliably, without needing a full sync system.

That’s it.
