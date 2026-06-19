# JBT New Style 1

## Official MCC Visual Style

**JBT New Style 1** is the official visual style for the Maintenance Command Center (MCC). It defines a clean, modern command-center interface for maintenance department workflows while keeping the application practical, readable, and easy to operate on desktop, tablet, and phone screens.

## Core Visual Direction

The MCC interface should feel like a focused maintenance operations dashboard:

- Dark navy command center background
- Cyan and blue maintenance highlights
- Clean maintenance department look
- Modern but not overdesigned
- Clear labels and obvious interaction points
- Large clickable buttons for fast use in busy shop or field environments

## Color System

### Background

Use a **dark navy command center background** as the primary application surface. The background should provide a stable, professional operations feel without becoming visually heavy or distracting.

Recommended usage:

- Main app shell background
- Dashboard page background
- Sidebar background or sidebar-adjacent surfaces
- Supporting panels behind dashboard cards

### Highlights

Use **cyan and blue maintenance highlights** to draw attention to active states, important actions, dashboard metrics, navigation indicators, and status accents.

Recommended usage:

- Active sidebar navigation item
- Primary buttons
- Dashboard card accents
- Metric icons or borders
- Maintenance status indicators
- Focus and hover states

The highlight color should support the maintenance command center identity without making the UI feel neon, gaming-oriented, or overdesigned.

## Layout Principles

### Sidebar Navigation

MCC should use **sidebar navigation** as a primary structural element. The sidebar should make major command center areas easy to find and should visually anchor the application.

Sidebar guidance:

- Keep navigation labels short and readable.
- Use clear active states.
- Favor simple icons or text labels over decorative elements.
- Ensure touch targets remain large enough for tablet use.
- Keep navigation predictable and stable across MCC screens.

### Dashboard Cards

Use **large rounded dashboard cards** for major content areas, summaries, and command center actions.

Card guidance:

- Cards should be spacious and easy to scan.
- Rounded corners should feel modern and approachable.
- Content hierarchy should be clear: title, value/status, supporting text, action.
- Avoid dense or cramped card layouts.
- Cards may use cyan/blue accents, but should not rely on excessive decoration.

### Tablet and Phone Friendly Spacing

MCC should maintain **tablet/phone friendly spacing** throughout the interface.

Spacing guidance:

- Use generous padding around cards, buttons, and form controls.
- Avoid placing critical actions too close together.
- Keep tap targets large and easy to select.
- Preserve readability on smaller screens.
- Allow dashboard content to stack cleanly when horizontal space is limited.

## Interaction Style

### Labels

Labels should be simple, direct, and easy to understand for maintenance department users.

Label guidance:

- Prefer plain operational language.
- Avoid vague labels.
- Keep headings short.
- Make button actions obvious.
- Use consistent terminology across MCC.

### Buttons

Buttons should be **large, clear, and clickable**.

Button guidance:

- Primary actions should use cyan/blue styling.
- Buttons should have clear text labels.
- Touch targets should support desktop, tablet, and phone use.
- Avoid small icon-only buttons for critical actions.
- Hover, focus, and active states should be visible.

## Product Boundaries

### Inventory Placeholder

Inventory in MCC must remain a **protected placeholder** until Maintenance Inventory Tracker 3 (MIT3) is integrated.

Inventory guidance:

- Do not present MCC inventory as a live integrated inventory system until MIT3 integration is complete.
- Placeholder inventory screens or cards should clearly communicate that inventory is protected or pending integration.
- Avoid UI language that implies inventory data is fully connected when it is not.

### Port Separation

MCC and MIT3 remain separate applications during this style phase.

- **MCC stays on port 4273.**
- **MIT3 stays separate on port 4173.**

Do not combine the two applications or imply that MIT3 has been merged into MCC as part of this visual style.

## Implementation Guardrails

This document defines visual direction only. It does not require frontend, backend, package, or script changes.

For this style phase:

- Do not change frontend code.
- Do not change backend code.
- Do not change package files.
- Do not change scripts.
- Use this document as the reference for future MCC visual implementation work.

## Style Summary

**JBT New Style 1** should make MCC feel like a dependable maintenance command center: dark navy, clean, readable, spacious, and operationally focused. Cyan and blue highlights provide energy and clarity, while large rounded cards, sidebar navigation, and touch-friendly spacing keep the application practical for real maintenance department use.
