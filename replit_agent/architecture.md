# Architecture Documentation

## Overview

SMM Manager is an intelligent social media content management platform designed to help content creators with AI-powered content generation, analytics, and multi-platform publishing strategies. The application provides adaptive workflows for content creation with intelligent scheduling, AI-assisted multi-language content creation, and direct publishing capabilities to various social media platforms.

The system uses a modern web stack with React on the frontend and a Node.js backend, with PostgreSQL and Directus for data management. It integrates with multiple AI services for content generation and various social media platforms for publishing.

## System Architecture

### High-Level Architecture

The SMM Manager employs a client-server architecture with the following main components:

1. **Frontend**: A React application using TypeScript, built with Vite
2. **Backend**: A Node.js API server using Express.js
3. **CMS**: Directus as a headless CMS and API layer over PostgreSQL
4. **Database**: PostgreSQL for structured data storage with Drizzle ORM
5. **Storage**: Beget S3-compatible storage for media files (images, videos)
6. **External Services**: Multiple AI providers and social media platform APIs

### Architecture Diagram (Simplified)

```
┌─────────────┐      ┌────────────┐      ┌──────────────┐
│             │      │            │      │              │
│  React UI   │<────>│  API       │<────>│  Directus    │
│  (Client)   │      │  Server    │      │  (CMS/Auth)  │
│             │      │            │      │              │
└─────────────┘      └────────────┘      └──────────────┘
                           ^                    ^
                           │                    │
                           v                    v
              ┌──────────────────┐     ┌──────────────┐
              │                  │     │              │
              │  External APIs   │     │  PostgreSQL  │
              │  - AI Services   │     │  Database    │
              │  - Social Media  │     │              │
              └──────────────────┘     └──────────────┘
                           ^
                           │
                           v
                    ┌─────────────┐
                    │             │
                    │  Beget S3   │
                    │  Storage    │
                    │             │
                    └─────────────┘
```

## Key Components

### Frontend

The frontend is a React application using TypeScript, built with Vite. It employs:

- **React Query**: For state management and API request handling
- **Shadcn UI**: For component styling with Tailwind CSS
- **React Hook Form**: For form handling with validation
- **Custom Middleware**: For token-based authentication refreshing

The frontend provides an intuitive interface for content planning, creation, and scheduling with support for rich HTML editing and media management.

### Backend

The backend is a Node.js application using Express.js, providing:

- **REST API endpoints**: For managing content and social media integration
- **Webhook handlers**: For integration with third-party services like n8n
- **Authentication proxy**: For secure communication with Directus CMS
- **Media processing**: For handling image and video uploads

The backend includes services for:
- Social media publishing (Telegram, Instagram, Facebook, VK)
- AI-powered content generation
- Content templating
- File storage and media processing

### Data Layer

The data management architecture consists of:

- **Directus**: Headless CMS providing an admin interface and API layer
- **PostgreSQL**: Primary database for structured data
- **Drizzle ORM**: For database schema management and type-safe queries
- **Beget S3 Storage**: For storing media files (images, videos)

### Integration Architecture

The system integrates with various external services:

- **AI Services**: 
  - Anthropic (Claude)
  - Google Gemini
  - DeepSeek
  - FAL AI
  - Perplexity
  
- **Social Media APIs**:
  - Facebook/Instagram Graph API
  - Telegram Bot API
  - VK API

- **External Systems**:
  - n8n for workflow automation
  - Beget S3 for object storage

## Data Flow

### Content Creation Flow

1. User creates a content plan in the UI
2. The UI sends the content plan to the API server
3. The API server stores the plan in PostgreSQL via Directus API
4. User requests AI-generated content options based on the plan
5. The API server communicates with AI services to generate content
6. Generated content options are presented to the user for selection/editing
7. Finalized content is saved with scheduling information

### Publishing Flow

1. The system identifies content scheduled for publishing
2. The API server retrieves the content and associated media
3. Media files are processed if needed (resizing, format conversion)
4. The publishing service connects to the appropriate social media API
5. Content and media are published to the selected platform(s)
6. Publication results, including URLs and status, are saved back to the database
7. Notification is sent to the user about successful/failed publication

### Authentication Flow

1. User logs in via the frontend UI
2. Authentication request is sent to Directus
3. Directus validates credentials and returns access/refresh tokens
4. Frontend stores tokens and includes them in subsequent API requests
5. Custom middleware handles token expiration and refresh
6. For social media operations, platform-specific tokens are retrieved from secure storage

## External Dependencies

### Core Dependencies

- **Directus**: Headless CMS and API layer for content management
- **PostgreSQL**: Primary database for structured data
- **Node.js**: Runtime environment for the backend
- **React**: Frontend library

### AI Service Providers

- **Anthropic Claude**: Advanced text generation and summarization
- **Google Generative AI**: Text and image generation
- **FAL AI**: Image generation and manipulation
- **Perplexity**: Advanced search and information retrieval
- **DeepSeek**: Additional AI capabilities

### Social Media Platforms

- **Facebook/Instagram**: Using Graph API for content publishing
- **Telegram**: Using Bot API for messaging
- **VK**: Russian social network integration

### Infrastructure Services

- **Beget S3**: S3-compatible storage for media files
- **n8n**: Workflow automation

## Deployment Strategy

The application is designed for multiple deployment scenarios:

### Development Environment

- Uses local PostgreSQL instance
- Connects to staging Directus instance
- Environment variables are loaded from `.env` files
- Runs in development mode with hot reloading

### Docker-based Deployment

- Multi-container deployment with Docker Compose
- Containers for:
  - Frontend application
  - Backend API server
  - PostgreSQL database
  - Directus CMS
  - pgAdmin (optional)
  - n8n workflow engine
- Uses environment variables from `.env.docker`
- NGINX for reverse proxying and SSL termination

### Replit Deployment

- The application is configured to run on Replit
- Uses Replit's PostgreSQL module
- Custom run configurations in `.replit` file
- Environment variables stored in Replit Secrets

## Security Considerations

- **Authentication**: JWT-based authentication via Directus
- **API Keys**: External service API keys stored securely
- **Media Storage**: Secure S3 storage with signed URLs
- **Social Media Tokens**: Stored securely and encrypted
- **Content Validation**: Input sanitization to prevent XSS and injection attacks

## Future Architecture Considerations

- **Scalability**: Potential to separate services into microservices
- **Caching**: Implement Redis for caching frequent operations
- **Monitoring**: Add logging and monitoring infrastructure
- **High Availability**: Implement redundancy for critical components
- **Internationalization**: Enhance multi-language support infrastructure
=======
# Architecture Overview

## Overview

SMM Manager is an intelligent social media management platform that helps content creators with AI-assisted content generation, analytics, and multi-platform publishing strategies. The platform provides adaptive workflows for content creation with intelligent scheduling, multi-language content generation using AI, and direct publishing capabilities to various social media platforms.

## System Architecture

The system follows a modern client-server architecture with a clear separation between frontend and backend components:

### Frontend Architecture

- **Technology Stack**: React with TypeScript, using a component-based architecture
- **State Management**: React Query for server state management
- **UI Framework**: Shadcn UI (based on Tailwind CSS and Radix UI)
- **Routing**: Implicit from the project structure, likely using React Router
- **Build Tool**: Vite for fast development and optimized production builds

### Backend Architecture

- **Technology Stack**: Node.js with Express.js
- **API Design**: RESTful API design pattern for client-server communication
- **Authentication**: Custom middleware for JWT token management and refresh
- **File Upload**: Multer for handling multipart/form-data

### Data Storage

- **Primary Database**: PostgreSQL with Drizzle ORM for database interactions
- **Schema Management**: Drizzle for type-safe schema definitions and migrations
- **Cloud Storage**: Beget S3 (S3-compatible storage) for media files, particularly videos

### External Integrations

- **CMS**: Directus as a headless CMS for content management
- **Workflow Automation**: n8n for workflow automation and content planning
- **Social Media**: Direct integrations with Facebook/Instagram, Telegram, and VK

## Key Components

### Client Components

1. **Authentication System**
   - JWT-based authentication with automatic token refresh
   - Role-based access control (Admin/User permissions)

2. **Content Editor**
   - Rich text editing capabilities with HTML formatting
   - Media upload and management for images and videos
   - Emoji picker integration

3. **Content Scheduler**
   - Calendar interface for scheduling posts
   - Time zone management for consistent scheduling across regions

4. **AI Content Generation**
   - Integration with multiple AI providers (DeepSeek, Perplexity, Google's Generative AI, Claude)
   - Content enhancement and optimization tools

### Server Components

1. **API Layer**
   - RESTful endpoints for client-server communication
   - Security middleware for authentication and authorization
   - Rate limiting and error handling

2. **Social Media Publishing Services**
   - Platform-specific publishing adapters (Telegram, Instagram, Facebook, VK)
   - Media transformation and format optimization
   - Post status tracking and URL storage

3. **Media Processing Service**
   - Video processing with ffmpeg
   - Image optimization for various platforms
   - S3 storage integration for media assets

4. **Authentication Service**
   - Token generation and validation
   - User session management
   - Integration with Directus authentication

## Data Flow

1. **Content Creation Flow**
   - User creates content in the UI editor
   - Content is optionally enhanced with AI assistance
   - Media files are uploaded to Beget S3 storage
   - Content metadata and references are stored in PostgreSQL

2. **Publishing Flow**
   - Scheduled content is retrieved based on publication time
   - Platform-specific formatting is applied (HTML sanitization, media optimization)
   - Content is published to selected social platforms via their APIs
   - Publication results and URLs are stored back in the database

3. **Authentication Flow**
   - User logs in via Directus authentication
   - JWT tokens are issued and managed by the custom auth middleware
   - Token refreshing is handled automatically before expiration

## External Dependencies

### Social Media Platforms
- **Facebook/Instagram**: Graph API for post publishing and management
- **Telegram**: Bot API for channel and group posting
- **VK**: VK API for community posting

### AI Services
- **Google Generative AI**: For content generation and enhancement
- **Claude AI (Anthropic)**: Advanced AI assistant for content creation
- **FAL AI**: Image generation and manipulation
- **DeepSeek/Perplexity**: Additional AI providers for content optimization

### Infrastructure Services
- **Beget S3**: S3-compatible cloud storage for media files
- **Directus**: Headless CMS for content management
- **n8n**: Workflow automation platform integrated for content planning

## Deployment Strategy

The application is designed for flexible deployment with multiple options:

1. **Docker Deployment**
   - Docker Compose configuration for all service dependencies
   - Container orchestration for scaling individual components
   - Environment-specific configuration through .env files

2. **Replit Deployment**
   - Configuration for direct deployment on Replit platform
   - Utilizing Replit's persistent storage and environment

3. **Development Environment**
   - Local Node.js server with hot reloading
   - PostgreSQL local instance
   - Environment variable management for different contexts

### Environment Configuration
- Comprehensive environment variable management for different deployment scenarios
- Sensitive information (API keys, tokens) managed through environment variables
- Different configurations for development, testing, and production environments

## Security Considerations

- JWT token-based authentication with proper expiration and refresh mechanism
- Secure storage of API keys and authentication tokens
- HTML sanitization for user-generated content
- HTTPS enforcement for all API communications
- Proper error handling to prevent information leakage
