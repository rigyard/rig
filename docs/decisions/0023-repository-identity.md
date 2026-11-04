# 0023. Repository commit identity and visibility

- Status: Accepted
- Date: 2026-11-04

## Context

The machine's global git identity does not belong to this project. The repository needs its own commit identity. The user decided how this repository handles commit signing.

## Decision

- Commits are authored as the repository owner's account, through that account's GitHub noreply email.
- Commits are unsigned. This is an explicit exception for this repository only.
- The identity and the signing setting live in the repository's local git config (`git config --local`), not in the global config.
- The repository is private for now.

## Consequences

- The global identity and signing rule stay unchanged for every other repository.
- Unsigned commits carry no cryptographic author proof. Revisit before the repository goes public or accepts outside contributions.
- The repository docs name no account. The identity lives only in local git config.
