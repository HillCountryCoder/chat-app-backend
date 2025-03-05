# Chat Application

A real-time chat application built with Node.js, Express, MongoDB, Redis, and Socket.IO.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/)

## Development Setup

### First-time setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/chat-app.git
   cd chat-app
   ```

2. Create a `.env` file from the example:
   ```
   cp .env.example .env
   ```

3. Run the setup command to install dependencies, start databases, and run the app:
   ```
   npm run dev:setup
   ```

This will:
- Install all dependencies
- Start MongoDB and Redis in Docker containers
- Start the application in development mode

### Regular development

Once set up, you can use these commands:

- Start the database containers:
  ```
  npm run db:up
  ```

- Start the development server (with hot reloading):
  ```
  npm run dev
  ```

- Stop the database containers:
  ```
  npm run db:down
  ```

- Reset the database (WARNING: This will delete all data):
  ```
  npm run db:reset
  ```

## Database Management

- MongoDB runs on `localhost:27017`
- MongoDB Express (web UI) is available at `http://localhost:8081`
  - Username: `admin`
  - Password: `password`

## Building for Production

```
npm run build
npm start
```