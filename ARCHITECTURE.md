# Architecture

## Tech Stack

- React 18 + TypeScript
- Vite (bundler)
- CSS Variables (no Tailwind, no styled-components)
- No Redux — only useState + custom hooks

## Folder Structure

src/
├── components/ # Pure UI components, no API calls
│ ├── ChatMessage.tsx
│ ├── SourceCard.tsx
│ └── UploadPanel.tsx
├── hooks/ # All business logic + API calls live here
│ └── useChat.ts
├── types/ # All TypeScript interfaces
│ └── index.ts
├── App.tsx # Root layout only, no business logic
└── index.css # All styles, CSS variables only

## Data Flow Rule

User Action → Component → Custom Hook → API Call → State Update → Re-render

## Rules

- Components NEVER call fetch() directly
- All API logic goes inside hooks/
- All types go inside types/index.ts
- App.tsx is layout only
