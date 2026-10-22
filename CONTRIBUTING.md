# Contributing themes

[中文版](CONTRIBUTING.zh-CN.md)

We welcome theme proposals and finished submissions for Clawd. After maintainer review and release checks, accepted themes can be downloaded through **Settings → Theme**. Their artwork stays outside the application installer.

**Start with a [theme submission issue](https://github.com/rullerzhou-afk/clawd-themes/issues/new?template=theme-submission.yml).** English and Chinese are both welcome. If you only have an idea, include sketches or references and describe what you plan to make. An idea is a proposal, not an installable theme or a commitment by maintainers to produce it.

We consider distinctive design, completeness, usability, asset provenance, and maintenance. Submission or passing format checks does not guarantee inclusion. Different interpretations of the same character are welcome for review; explain the differences and use a separate theme ID.

## Make and try your theme

Install Clawd and follow the main repository's [theme creation guide](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md), which documents `theme.json`, state mappings, and capability switches.

The scaffold script needs Node.js 22.12 or newer. Run these commands in the **clawd-on-desk application repository**, not this distribution repository:

```sh
git clone https://github.com/rullerzhou-afk/clawd-on-desk.git
cd clawd-on-desk
node scripts/create-theme.js my-theme --name "My Theme" --author "Your Name"
```

The script prints the new theme directory. Edit its `theme.json` and `assets/`. The scaffold contains example filenames, not a complete set of animations. Supply the assets, or remove unused optional mappings and disable those capabilities, before validating and trying the theme. Select it in **Settings → Theme**; restart Clawd if a newly created folder is not listed.

- Supported artwork formats are SVG, GIF, APNG, WebP, PNG, JPG, and JPEG. Static themes are welcome; pixel art and any particular generation tool are optional. Convert MP4 videos to a supported image or animation format first.
- `idle`, `thinking`, and `working` need real files; `sleeping` needs files or a valid `fallbackTo`. Completion, errors, and notifications should have understandable visuals or fallbacks.
- A small, complete theme is a good start. You do not need to match an existing theme's animation count. Explicitly disable eye tracking or mini mode if you do not provide them. Set `sleepSequence.mode: "direct"` to omit the full sleep sequence. See the creation guide for details.
- Choose a distinct theme ID, used as the folder name. Do not use `clawd`, `calico`, `cloudling`, `hash-sage`, `whale-chan`, `template`, or another existing catalog ID.
- External SVGs are sanitized. They cannot rely on embedded JavaScript, network resources, or `trustedRuntime`. Include the required artwork as local assets.

Run the validator from the application repository, replacing the path with the directory printed by the scaffold:

```sh
node scripts/validate-theme.js "/absolute/path/to/my-theme"
```

Then try the theme in Clawd. Check transparent edges, readability at normal pet sizes, position and scale across state changes, loop seams, clicks, and dragging. Check mini mode and roaming if provided. Report the Clawd version and operating system actually tested, along with anything untested. Format validation does not replace these checks.

## What to submit

Include these details in your issue:

1. Theme name, proposed ID, author credit, and how it differs from existing themes.
2. A clear preview image; for animated themes, recordings or animations showing representative actions.
3. A downloadable theme folder or ZIP, including `theme.json`. If you have a source repository, link the repository, a fixed commit, and the theme's directory. Otherwise, explain how you can deliver the files and agree on a recorded release source with maintainers later.
4. Implemented states and optional features, theme version, tested Clawd versions and systems, validation results, and known issues.
5. Asset sources, creators, and full license information, including third-party references or adaptations and any generation tools used. “Found online” is not sufficient provenance.
6. Who will maintain updates and where feedback should go.

Artists and people with ideas can open a proposal to find collaborators. State what work remains. Maintainers will discuss whether to proceed and what is missing in the issue.

## Files and licensing

A deliverable theme typically contains:

```text
my-theme/
  theme.json
  assets/
    idle.webp
    thinking.webp
    working.webp
    sleeping.webp
  README.md
  LICENSE
```

Use `README.md` for author credits, version, installation instructions, capabilities, and known limitations. Include the applicable terms and third-party credits in `LICENSE`. Explain whether this repository may distribute the package and previews, and whether users may download, install, and use them. Only provide material you have the right to supply; a reference image is not permission.

Each theme keeps its own license. The application's AGPL source license does not automatically apply to artwork, and an existing theme's license is not a generic template to reuse. Generation tools and paid subscriptions do not replace provenance and licensing information.

Do not commit large assets, videos, or ZIPs to `clawd-on-desk` or this repository's Git history. Supply them through the author's repository, a versioned release, or downloadable attachments. Maintainers publish accepted packages as releases in this repository.

## Pull requests

Link your submission issue and agree on scope with maintainers first. This repository normally needs only:

```text
themes/<theme-id>/
  README.md
  LICENSE
  preview.webp
  manifest.json
```

`manifest.json` records distribution metadata; it is separate from the runtime `theme.json`. Its version, source, license, and asset count must match the theme. Initial proposals do not need a manifest. If you are unfamiliar with Git, provide the materials in the issue and agree with maintainers on how to submit these files.

Use a WebP preview no larger than 1 MiB. Keep large animations in the source repository and releases. Theme IDs use lowercase letters, digits, and hyphens, with 1–64 characters. Versions use three numbers, such as `1.0.0`.

**Do not edit `catalog-v1.json` or add unpublished download URLs in an initial submission.** Maintainers handle release and catalog changes using the [publishing checks](docs/publishing.md). The current verifier still has a historical source restriction: provide the real source, and maintainers must resolve that compatibility issue before publishing community artwork.

## Independent sharing and updates

You can publish your theme independently for manual installation without waiting for catalog inclusion. A ZIP must contain one theme, with `theme.json` at the root or inside one top-level folder. In Clawd versions that provide it, use **Settings → Theme → Import Clawd theme package (.zip)**. Otherwise, place the theme folder in the user themes directory:

| System | Default directory |
| --- | --- |
| Windows | `%APPDATA%/clawd-on-desk/themes/` |
| macOS | `~/Library/Application Support/clawd-on-desk/themes/` |
| Linux | `~/.config/clawd-on-desk/themes/` (or `clawd-on-desk/themes/` under `XDG_CONFIG_HOME` when set) |

Ordinary ZIP import has different limits from catalog downloads: 80 MiB for the ZIP, 160 MiB unpacked, and 40 MiB per file. Themes exceeding import limits can be placed manually as described in the creation guide; discuss catalog suitability with maintainers.

For updates to an accepted theme, increase the theme version, link the original issue, and supply a changelog, updated assets, and new test results. Published versioned assets are never replaced in place; maintainers review a new release package. If you can no longer maintain the theme, note that in its issue.
