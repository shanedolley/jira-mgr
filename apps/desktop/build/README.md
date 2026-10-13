# Build Assets

The app icon. `icon.svg` is the source, a 1024 px canvas holding an 824 px blue tile with three stacked white chevrons. `pnpm icon` renders it and rewrites the other two.

| File        | Holds                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `icon.svg`  | The source. Edit this, then run `pnpm icon`                           |
| `icon.png`  | 512 px render that `pnpm dev` sets as the Dock icon                   |
| `icon.icns` | Every macOS size, from 16 px to 1024 px, that `pnpm package` installs |
