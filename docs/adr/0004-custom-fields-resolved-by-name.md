---
status: accepted
date: 2026-10-07
deciders: Shane Dolley
---

# Custom Fields Resolved by Name

jira-mgr depends on four custom fields: Customer, Engagement, Sprint and Start date. On PSAPAC they are `customfield_14849`, `customfield_14850`, `customfield_10600` and `customfield_13808`, but login accepts any site and project ([ADR-0003](0003-token-in-own-keychain-item.md)). At login we resolve each field's id by name from the project's create metadata, cache the ids, and let a settings file override any of them. Create metadata lists only the fields on the project's screens, which matters because the site holds other fields named "Customer" (`customfield_16534`, `customfield_16634`, `customfield_18000`) that PSAPAC does not use. Source: [discovery](../discovery/2026-10-07-product-grilling.md) Q36.

## Considered Options

1. **Hard-code PSAPAC's field ids** - no lookup, but the site and project inputs on the login screen would be decorative, and another project would silently write to the wrong fields.
2. **Search the site's fields by name** - finds every field named "Customer" and has no way to tell PSAPAC's from the rest.

## Consequences

- Login fails with a clear message when a field name is missing from create metadata, or matches more than one field there. The settings file override is the way past either.
- Sprint is absent from Epic and Subtask screens, so resolution reads create metadata across all of the project's issue types, not one.
- The cached ids go stale if a Jira admin renames or replaces a field. Logging in again re-resolves them.
- Customer and Engagement option values come from the same metadata, which also feeds `jm field options`.
- Any further custom field the app comes to depend on, such as Time remaining (h), joins the resolved list rather than being hard-coded.
