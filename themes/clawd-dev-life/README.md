# Clawd Dev Life

English | [简体中文](https://github.com/rullerzhou-afk/clawd-stickers/blob/1e349fae7819deda71d9091b743bebfb75e0b6f7/dev-life/theme/clawd-dev-life/README.zh-CN.md)

A [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) theme in which Clawd acts out everyday developer life.

- **Author**: alwinecor
- **Version**: 1.2.0
- **Theme ID**: `clawd-dev-life`
- **Source**: <https://github.com/alwinecor/clawd-stickers>

## Install

In clawd-on-desk 1.5.0 or later, download this theme from the community themes under **Settings... → Theme**.

To install it by hand, copy this folder into your clawd-on-desk themes folder, then pick the theme under **Settings... → Theme**.

This theme includes light assets in `assets/` and dark assets in `assets-dark/`. clawd-on-desk follows the system appearance by default; you can also choose manually under **Settings → Theme → Customize → Color scheme**. Older versions of clawd-on-desk show only the light assets.

| System | Themes folder |
| --- | --- |
| Windows | `%APPDATA%/clawd-on-desk/themes/` |
| macOS | `~/Library/Application Support/clawd-on-desk/themes/` |
| Linux | `~/.config/clawd-on-desk/themes/` |

## Supports

- Every agent state, including thinking, working, subagents, context compaction, errors, the full sleep sequence and more
- Separate animations for two and for three or more active sessions, with several Clawds on screen
- Eye tracking while idle, random idle animations, roaming, dragging and click reactions
- Mini mode with its own story: Clawd hides behind a cubicle wall, which is the edge of your screen

## Known limitations

- Pet tint is turned off.
- No custom sound effects.
- Tested with clawd-on-desk 1.6.0 on Windows. MacOS and Linux are untested.

## Animations

The theme has 58 animations. Where a moment lists several, one of them plays. Most come from the [Dev Life stickers](https://github.com/alwinecor/clawd-stickers/blob/main/dev-life/README.md), where you can read more about each one. The 11 mini mode animations exist only in this theme.

### Working

| When | Preview | Animation |
| --- | --- | --- |
| A prompt is submitted | <img src="assets/thinking.apng" width="96"> | **Thinking** |
| | <img src="assets/ultrathink.apng" width="96"> | **ultrathink** |
| | <img src="assets/plan.apng" width="96"> | **Plan Mode** |
| Using tools, one session | <img src="assets/todo.apng" width="96"> | **Todo List** |
| | <img src="assets/simple.apng" width="96"> | **It's Simple** |
| | <img src="assets/bug.apng" width="96"> | **Bug Hunt** |
| | <img src="assets/loop.apng" width="96"> | **while(true)** |
| | <img src="assets/deadline.apng" width="96"> | **Deadline** |
| Using tools, two sessions | <img src="assets/team2.apng" width="96"> | **Team of Two** |
| | <img src="assets/conflict.apng" width="96"> | **Merge Conflict** |
| Using tools, three or more sessions | <img src="assets/team3.apng" width="96"> | **Team of Three** |
| A subagent is active | <img src="assets/subagents.apng" width="96"> | **Subagents** |
| Compacting context | <img src="assets/compact.apng" width="96"> | **/compact** |
| Creating a worktree | <img src="assets/clone.apng" width="96"> | **git clone** |
| Permission request or alert | <img src="assets/proceed.apng" width="96"> | **Yes, Proceed** |
| Task completed | <img src="assets/passed_long.apng" width="96"> | **Tests Passed (extended)** |
| | <img src="assets/lgtm.apng" width="96"> | **LGTM** |
| Tool failure | <img src="assets/error.apng" width="96"> | **Error** |

### Idle

| When | Preview | Animation |
| --- | --- | --- |
| No activity | <img src="assets/idle.svg" width="96"> | **Idle** |
| Free roam | <img src="assets/roam.svg" width="96"> | **Walk** |
| Random idle scene | <img src="assets/fish.apng" width="96"> | **Slacking Off** |
| | <img src="assets/coffee.apng" width="96"> | **Coffee Break** |
| | <img src="assets/duck.apng" width="96"> | **Rubber Duck** |
| | <img src="assets/works.apng" width="96"> | **Works on My Machine** |
| | <img src="assets/blame.apng" width="96"> | **git blame** |
| | <img src="assets/deploy.apng" width="96"> | **Friday Deploy** |
| | <img src="assets/overtime.apng" width="96"> | **Overtime** |
| | <img src="assets/offwork.apng" width="96"> | **Clock Out** |
| | <img src="assets/leak.apng" width="96"> | **Memory Leak** |
| | <img src="assets/overflow.apng" width="96"> | **Stack Overflow** |
| | <img src="assets/cherry.apng" width="96"> | **cherry-pick** |
| | <img src="assets/esc.apng" width="96"> | **Esc** |
| | <img src="assets/forcepush.apng" width="96"> | **Force Push** |
| | <img src="assets/stash.apng" width="96"> | **git stash** |
| | <img src="assets/clear.apng" width="96"> | **/clear** |
| | <img src="assets/bye_long.apng" width="96"> | **/exit (extended)** |

### Interaction

| When | Preview | Animation |
| --- | --- | --- |
| Dragged | <img src="assets/drag.svg" width="96"> | **Drag** |
| Double-click | <img src="assets/hello.apng" width="96"> | **hello, world**<br>Left side. |
| | <img src="assets/right.apng" width="96"> | **You're Absolutely Right!**<br>Right side. |
| | <img src="assets/notfound.apng" width="96"> | **404 Not Found**<br>A 50% chance. |
| Four rapid clicks | <img src="assets/rmrf.apng" width="96"> | **rm -rf** |
| | <img src="assets/detached_long.apng" width="96"> | **detached HEAD (extended)** |
| | <img src="assets/banned_long.apng" width="96"> | **Banned (extended)** |
| Mouse circled around Clawd | <img src="assets/dizzy.apng" width="96"> | **Dizzy** |

### Sleep

| When | Preview | Animation |
| --- | --- | --- |
| Falling asleep | <img src="assets/yawn.apng" width="96"> | **Yawn** |
| Asleep | <img src="assets/sleep.apng" width="96"> | **Good Night** |
| Waking up | <img src="assets/wake.apng" width="96"> | **Wake** |

### Mini mode

Drag Clawd to the left or right screen edge, or enter from the menu. Hide, Headphones On and Who's There play once and stay on their last frame, so their previews below also play only once.

| When | Preview | Animation |
| --- | --- | --- |
| Walking to the screen edge | <img src="assets/mini-crabwalk.svg" width="160"> | **Slip Away** |
| Entering mini mode | <img src="assets/mini-enter.apng" width="160"> | **Hide** |
| No activity | <img src="assets/mini-idle.svg" width="160"> | **Lookout** |
| Mouse moves onto Clawd | <img src="assets/mini-peek.apng" width="160"> | **Caught** |
| Mouse stays | <img src="assets/mini-peek-hold.apng" width="160"> | **Say Hi** |
| Thinking, using tools or running subagents | <img src="assets/mini-working.apng" width="160"> | **Working in Secret** |
| Permission request or alert | <img src="assets/mini-alert.apng" width="160"> | **Someone's Asking** |
| Task completed | <img src="assets/mini-happy.apng" width="160"> | **Green Flag** |
| Entering with Do Not Disturb on | <img src="assets/mini-enter-sleep.apng" width="160"> | **Headphones On** |
| Do Not Disturb | <img src="assets/mini-sleep.apng" width="160"> | **Nap** |
| Mouse moves onto Clawd during Do Not Disturb | <img src="assets/mini-sleep-peek.apng" width="160"> | **Who's There** |

## License

See [LICENSE](LICENSE). This is an unofficial fan theme, not affiliated with or endorsed by Anthropic.
