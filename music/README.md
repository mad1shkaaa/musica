# Папка music — треки для сайта

Сюда загружаются mp3-файлы. Сайт берёт их по адресу `music/<имя файла>` относительно `index.html`.
Адрес работает одинаково через `node server.js`, на Vercel и на GitHub Pages.

## Как загрузить (с компьютера или iPad, без терминала)

1. На GitHub откройте ветку `claude/elevenlabs-dynamic-tts-afu6ra` → папку **music**.
2. Нажмите **Add file → Upload files**, перетащите mp3 и нажмите **Commit changes**.
3. Файлы должны оказаться рядом с этим README: `music/имя.mp3`.

> Через браузер GitHub принимает файлы до 25 МБ каждый.

## Имена должны совпадать с таблицей точно

- Регистр букв важен: `Coma-Media…` и `coma-media…` для сервера — разные файлы.
- Расширение — `.mp3` строчными буквами.
- Внутри `music/` не нужно других папок: файл `music/new/x.mp3` сайт не найдёт.
- Если файл загрузили в корень репозитория рядом с `index.html`, сайт его тоже найдёт: это запасной путь.
  Но правильное место — папка `music/`.

Сайт сам проверяет каждый трек. Если файла нет, при попытке включить музыку он покажет точный адрес, по которому искал.

| № | Файл | Название | Автор |
|---|---|---|---|
| 1 | `audiocopper-happy-indie-rock-636610.mp3` | Happy Indie Rock | AudioCopper |
| 2 | `audioera-inspiration-piano-music-637701.mp3` | Inspiration Piano | Audioera |
| 3 | `coma-media-glossy-168156.mp3` | Glossy | Coma-Media |
| 4 | `gr0za-fun-fun-music-468332.mp3` | Fun Fun Music | Gr0za |
| 5 | `kornevmusic-happy-latin-salsa-dance-621026.mp3` | Happy Latin Salsa Dance | KornevMusic |
| 6 | `luminewave-this-is-home-637005.mp3` | This Is Home | Luminewave |
| 7 | `lux-aeterna-winter-contemplation-634704.mp3` | Winter Contemplation | Lux Aeterna |
| 8 | `miromaxmusic-future-bass-no-copyright-637821.mp3` | Future Bass | MiromaxMusic |
| 9 | `pianocafe_kumi-japanese-style-piano-257200.mp3` | Japanese Style Piano | PianoCafe Kumi |
| 10 | `audiocopper-emotional-inspiration-632903.mp3` | Emotional Inspiration | AudioCopper |
| 11 | `audioera-acoustic-guitar-happy-637709.mp3` | Acoustic Guitar Happy | Audioera |
| 12 | `bransboynd-groovy-vibe-427121.mp3` | Groovy Vibe | Bransboynd |
| 13 | `echobrainz-dark-mystery-637056.mp3` | Dark Mystery | EchoBrainz |
| 14 | `gr0za-rap-vlog-beat-471184.mp3` | Rap Vlog Beat | Gr0za |
| 15 | `leonellcassio-leonell-cassio-the-sapphire-city-10450.mp3` | The Sapphire City | Leonell Cassio |
| 16 | `lux-aeterna-lonely-dreams-634727.mp3` | Lonely Dreams | Lux Aeterna |
| 17 | `mickeyscat-run-phonk-energy-no-copyright-637997.mp3` | Run (Phonk Energy) | Mickeyscat |
| 18 | `music_for_videos-inspiring-emotional-uplifting-piano-112623.mp3` | Inspiring Emotional Uplifting Piano | Music For Videos |
| 19 | `pink_sound-copper-nights-jazz-background-music-for-video-stories-full-version-633222.mp3` | Copper Nights Jazz | Pink Sound |
| 20 | `alex_makemusic-feels-like-saturday-637034.mp3` | Feels Like Saturday | Alex_MakeMusic |
| 21 | `purrplecat-serendipity-635081.mp3` | Serendipity | PurrpleCat |
| 22 | `sonicmystery-reality-634743.mp3` | Reality | SonicMystery |
| 23 | `strawberry_candy-aggressive-metal-music-metalize-635620.mp3` | Metalize | Strawberry_Candy |
| 24 | `studiokolomna-no-copyright-music-632665.mp3` | Energetic Music | StudioKolomna |
| 25 | `the_mountain-christmas-637784.mp3` | Christmas | The_Mountain |

Список задан в `index.html` (`TRACK_MANIFEST`, 25 треков). Чтобы добавить новый трек с другим именем,
допишите его туда в той же форме: `{"file": "x.mp3", "title": "…", "author": "…", "moods": ["calm"], "bpm": 96}`.
