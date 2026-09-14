# Crew Chief 2.0 by Archaeolab

This is the clean 2.0 repository for Crew Chief, separated from the original working prototype. The current runtime is carried forward as a stable baseline while the next architecture and workflow changes are developed here.

## Repository Rules

- Do not commit `.env`, OAuth client secrets, field exports, GIS source files, or personal test data.
- Use HTTPS hosting when testing phone GPS, PWA installation, and service-worker behavior.
- Keep the original `Archaeolab App` directory as the reference copy until 2.0 migration work is verified.

## 2.0 Starting Point

- Page-based workflow navigation with Site Details, STP Data & Strata, Saved STPs, Mapping, and Wrap Up.
- IndexedDB-backed session, project, photo, and GPS point persistence.
- Import/export controls, GPS mapping, parcel/grid tools, high-contrast mode, and PWA shell carried forward.
- Future work should move repeated behavior into focused modules instead of expanding the legacy monolithic `app.js`.

## Local Testing

Serve this folder over HTTP rather than opening `index.html` directly:

```powershell
py -m http.server 4173
```

Then open `http://localhost:4173/`. Phone GPS and installable PWA behavior should be tested from an HTTPS deployment such as GitHub Pages.

Static web app for recording shovel test pits (STPs), strata, crew details, and exporting field-ready data.

## Project Structure

- index.html: Application markup
- app.css: Styling
- app.js: App logic (local storage, exports, project library)
- manifest.webmanifest: PWA metadata for installability
- service-worker.js: Offline/app-shell caching for PWA behavior
- icons/: Install icons (192x192, 512x512, Apple touch icon)
- .github/workflows/deploy-pages.yml: GitHub Pages deployment workflow
- .nojekyll: Disables Jekyll processing on GitHub Pages

## Local Testing

Open index.html in a browser.

## Install As An App (PWA)

The app is configured as a Progressive Web App.

Requirements:

- Serve over HTTPS (GitHub Pages works)
- Use a modern browser that supports installable PWAs

Install options:

- Android (Chrome): browser menu -> Add to Home screen / Install app
- iPhone/iPad (Safari): Share -> Add to Home Screen
- Desktop (Chrome/Edge): click the Install icon in the address bar

## Publish To GitHub Pages (Recommended)

This repository includes an automatic Pages workflow.

### 1) Push to GitHub

- Create a new GitHub repository.
- Upload/push all files in this folder.
- Use main as the default branch.

### 2) Enable GitHub Pages

- Open repository Settings -> Pages.
- For Source, select GitHub Actions.

### 3) Deploy

- Push to main.
- GitHub Actions will publish the site automatically.

## Notes For Testers

- Data is stored in each tester's browser local storage.
- Saved projects and uploaded map images are browser-local and not shared between users.

## Short Tester Guide

1. Open the live app and confirm all sections load.
2. Create one STP with at least two strata and save it.
3. Upload stratum photos and verify names are auto-generated, editable, and deletable.
4. Save the session as a project, then load that project.
5. Export XLSX and CSV to confirm downloads work.

When reporting bugs, include browser/device, exact steps, expected result, actual result, and a screenshot if possible.

## Optional: Install Git On This Machine

Git was not available in this terminal session. If you want command-line push support, install Git for Windows:
https://git-scm.com/download/win
