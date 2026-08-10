# Credits

## Code

Written by **Yousuf Soomro**.

Copyright © 2026 Yousuf Soomro. Released under the MIT License — see
[LICENSE](LICENSE). You're free to use, modify and ship it, commercially or
otherwise, as long as the copyright notice stays with it.

That covers everything in `gl/`, `components/`, `app/`, and the config and build
files. It does **not** cover the contents of `public/`.

## Images

**The images in `public/` are not mine, and are not covered by the LICENSE.**

They're placeholder artwork collected from [Behance](https://www.behance.net)
while building this, purely to have something real to look at while tuning the
effects. I don't know who made most of them and I never tracked the sources.
They are not licensed for reuse — by me or by anyone cloning this repo.

### If you made one of these

I'd genuinely rather credit you properly or take it down than leave it like
this. Please [open an issue](../../issues) and I'll do either, whichever you
prefer — no argument, no need to explain yourself. If you'd rather not do it in
public, any contact route on my GitHub profile works too.

### If you're forking this

Replace them. Swap in your own work, something you've licensed, or images from a
public-domain source like [Unsplash](https://unsplash.com) — anything you
actually have the right to ship. Point `IMAGES` in
[`gl/config.js`](gl/config.js) at your files and update `PROJECTS` alongside it,
keeping both arrays the same length.

Don't assume the MIT license on the code extends to the pictures. It doesn't.

## Fonts

`public/Panchang-Medium.otf` is **Panchang** by the
[Indian Type Foundry](https://www.fontshare.com/fonts/panchang), distributed
through Fontshare. Free for personal and commercial use under their own licence,
which is not MIT — check their terms before redistributing the file. It's here
for convenience; swap it for any typeface you like in
[`app/globals.css`](app/globals.css).

## Built with

- [Three.js](https://threejs.org) — WebGL renderer
- [Next.js](https://nextjs.org) — app shell
- [lil-gui](https://lil-gui.georgealways.com) — the tuning panel
- [GSAP](https://gsap.com) — easing helpers
- [Tailwind CSS](https://tailwindcss.com) — the small amount of DOM styling

The ordered-dither approach is the standard recursive Bayer construction — no
lookup table, just `bayer2` folded into itself twice. Everything else in the
pipeline was worked out by trial and error against these images.
