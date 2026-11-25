# BiletFlow web app

React + TypeScript + Vite + Tailwind client for BiletFlow. It talks to the FastAPI backend in `../backend` (and to Supabase Auth for sign-in). See the [repository README](../README.md) for the full setup.

## Run

```bash
cp .env.example .env     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm install
npm run dev              # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | type-check (`tsc -b`) and production bundle |
| `npm test` | unit tests (`vitest`) |
| `npm run lint` | `oxlint` |

`VITE_API_URL` defaults to `http://localhost:8000`. Use the computer's LAN address if the app must be opened from another device.

## Structure

| Path | Contents |
| --- | --- |
| `src/pages/` | events, event details, tickets, orders, organizer dashboard and event management, support, admin console |
| `src/components/` | navbar, checkout modal, venue map and seating, ticket PDF, login and signup |
| `src/services/` | API client and typed calls per area (events, tickets, organizer, support, admin) |
| `src/i18n/` | Kazakh, Russian and English dictionaries |
| `src/context/`, `src/hooks/` | session and shared state |

Roles control the routes: attendees get events, tickets, orders and support; organizers add the dashboard and event management; platform admins get the admin console.
