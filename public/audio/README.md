`dial-up.mp3` is the user-provided `Dial Up Internet - Sound Effect (HD).mp3`,
trimmed to begin at 00:04.000 and retain the rest of the recording (about 8 seconds).
Metadata was removed and the audio re-encoded with libmp3lame at quality 2.

`kenney-rpg/` contains original, unmodified recordings from the user-provided
Kenney RPG Audio pack. Kenney Vleugels released the pack under CC0; its original
license is included in `kenney-rpg/License.txt`.

- `footstep00.ogg`: normal carpet footsteps.
- `footstep04.ogg`: pool decks and food-court hard floors.
- `footstep08.ogg`: heavier creature footsteps. Player running retains the carpet
  or hard-floor recording with a little more weight and brightness. Seeded gain,
  pitch, and filter variation keep repeated steps from sounding identical.
- `creak1.ogg`, `creak2.ogg`, `creak3.ogg`: quiet, fixed-position building settling,
  using the existing sparse event schedule, wall filtering, distance falloff, and room echo.
- `cloth4.ogg`: soft takeoff rustle for accepted jumps and double jumps.
- `metalClick.ogg`: quiet flashlight switch, shared by mouse, touch, keyboard, and gamepad.

Playback balances each recording's level and applies subtle seeded pitch variation,
surface filtering, and the existing spatial/room effects. Original files stay intact.

`water/` contains six single-step cuts from the user-provided shallow-water recording, replacing `footstep05`. They play alone for pool entry and walking/running in water, with no consecutive repeats. See `water/README.md` for source trim points and processing.
