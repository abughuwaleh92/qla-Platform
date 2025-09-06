# QLA Mathematics Lessons

Static site for publishing interactive math lessons.

## Structure
- `index.html` — lesson selector
- `lesson-1.html` — Lesson 1 (interactive)
- images: `qla_logo.png`, `qla_banner.png`, `teacher_photo.jpg`

## How to add a new lesson
1. Create `lesson-2.html` (copy `lesson-1.html` as a base if you wish).
2. Ensure any images used by the lesson sit next to the lesson file (or use an `assets/` folder).
3. Edit `index.html` and add another card linking to `lesson-2.html`.

Deploy with GitHub Pages: Settings → Pages → Build and deployment → *Deploy from a branch* (branch: `main`, folder: `/ (root)`).