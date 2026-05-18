# Detailed Prompt for SMM Manager Development

## Project Overview

Develop SMM Manager - an advanced AI platform for social media analysis and content management. The system should provide intelligent tools for collecting data from social networks, trend analysis, AI-powered content generation, and publication planning.

### Key System Functions:
1. Social media analysis and trend detection
2. Automated content generation based on trends
3. Planning and publishing content across different social networks
4. Cross-platform content adaptation
5. Business analytics and reporting

## Technical Architecture

### Technology Stack:
- **Frontend**: React with TypeScript, using ShadCN component templates for UI
- **Backend**: Node.js with Express
- **Data Storage**: External storage via Directus API
- **State Management**: React Query, Zustand
- **AI Integration**: DeepSeek, Perplexity API, FAL AI (for image generation)
- **Authorization**: Through Directus API (external system)
- **Asynchronous Task Processing**: Integration with N8N via webhooks

### Architectural Constraints:
1. The system must be deployed on Replit
2. Cannot use virtual environments or Docker containers
3. Cannot directly edit package.json or other configuration files
4. Must follow the existing project structure
5. All data interactions happen through Directus API, local database is not used

## Data Structure

### Main Data Types (stored in Directus):
1. **campaigns**:
   - id (primary key, serial)
   - directusId (external identifier from Directus)
   - name (campaign name)
   - description (campaign description)
   - userId (user relationship)
   - createdAt (creation date)
   - link (reference link)
   - socialMediaSettings (JSON with settings for different social networks)
   - trendAnalysisSettings (JSON with trend analysis settings)

2. **content_sources** (content sources):
   - id (primary key, serial)
   - directusId (external identifier from Directus)
   - name (source name)
   - url (source URL)
   - type (source type - instagram, telegram, vk, facebook)
   - userId (user relationship)
   - campaignId (campaign relationship)
   - createdAt (creation date)
   - isActive (activity status)

3. **campaign_content** (generated content):
   - id (primary key, uuid)
   - campaignId (campaign relationship)
   - userId (user ID)
   - title (content title)
   - content (main content in HTML format)
   - contentType (content type - text, text-image, video, video-text)
   - imageUrl, videoUrl (media links)
   - prompt (generation prompt)
   - keywords, hashtags, links (arrays of corresponding data)
   - createdAt, scheduledAt, publishedAt (dates)
   - status (status - draft, scheduled, published)
   - socialPlatforms (JSON with social network publication data)
   - metadata (additional metadata)

4. **campaign_trend_topics** (trend topics):
   - id (primary key, uuid)
   - title (trend title)
   - sourceId (source relationship)
   - campaignId (campaign relationship)
   - reactions, comments, views (engagement metrics)
   - createdAt (creation date)
   - isBookmarked (whether marked as favorite)
   - mediaLinks (JSON with media links)

5. **business_questionnaire** (business questionnaire):
   - id (primary key, uuid)
   - campaignId (campaign relationship)
   - companyName, contactInfo, businessDescription, etc. (business information)
   - createdAt (creation date)

All data is stored and managed through the Directus API. The project only uses TypeScript types and interfaces to describe data; no local database is used.

## API Integrations and External Services

### AI Service Integrations:
1. **DeepSeek API**:
   - Used for website analysis and content generation
   - Requires user's API key from the settings system
   - Supports "deepseek-chat" model for content generation
   - Temperature 0.3, maximum tokens 1500
   - Response format must contain JSON

2. **Perplexity API**:
   - Used for finding content sources
   - Works with "llama-3.1-sonar-small-128k-online" model
   - Requires user's API key
   - Optimized for finding Instagram accounts and other social sources

3. **FAL AI API**:
   - Used for image generation
   - Multiple models: "fast-sdxl", "stable-diffusion-v35-medium", "flux/schnell"
   - API key must be formatted as "Key {apiKey}"
   - Different endpoints for different models

4. **Social Searcher API**:
   - For searching content across social networks
   - Requires user's API key

5. **Apify API**:
   - For parsing social networks
   - Optimized for working with Instagram

### Directus Integration:
1. Used for storing user data and authorization
2. All API requests to user data go through Directus
3. Directus tokens are cached to optimize requests
4. Directus URL: "https://directus.nplanner.ru"

### Webhook Integrations:
1. Integration with N8N for processing social media publications
2. Requires N8N API key for sending data
3. Asynchronous processing of publication statuses

## Frontend Architecture

### Main Pages:
1. **Authentication** (/auth/login) - login page
2. **Campaigns** (/campaigns) - campaign list and management
3. **Campaign Details** (/campaigns/[id]) - campaign details
4. **Trends** (/trends) - trend topic analysis
5. **Content** (/content) - generated content management
6. **Keywords** (/keywords) - keyword management
7. **Posts** (/posts) - publication planning
8. **Analytics** (/analytics) - statistics and reports
9. **Tasks** (/tasks) - automated task monitoring

### Key UI Components:
1. **Layout.tsx** - main layout with sidebar menu
2. **CampaignSelector** - active campaign selection
3. **ContentGenerationDialog** - AI content generation
4. **ContentPlanGenerator** - content plan creation
5. **BusinessQuestionnaireForm** - business questionnaire form
6. **SocialPublishingPanel** - social media publication
7. **TrendsList** - trend display
8. **Calendar** - publication calendar
9. **SettingsDialog** - API key settings

### State Management:
1. **React Query** for API requests
2. **Zustand** for global state (authentication, selected campaign)
3. **LocalStorage** for saving tokens and user settings

## Content Generation Features

### AI Prompts:
1. **For Website Analysis**:
```
You are an expert in website content analysis. Your task is to analyze the specific content of a website and suggest EXCLUSIVELY relevant keywords that exactly match this website.

SPECIAL RESTRICTIONS:
!!! STRICT PROHIBITION !!! It is categorically forbidden to:
- Generate keywords about apartment planning/design/renovation if the site IS NOT ABOUT this topic
- Create "default" keywords that have no direct connection to the analyzed content
- Include keywords based on common templates if they are not confirmed by the site content

ANALYSIS INSTRUCTIONS:
1. First, carefully study ALL the provided information
2. Determine the EXACT topic and direction of the website
3. Formulate keywords ONLY based on the available data, without adding "default" topics
4. Consider that the site can be on ANY topic: health, technology, finance, hobbies, education, etc.
```

2. **For Content Generation**:
```
You are an expert in creating content for social networks with a focus on {industry}. Your task is to create high-quality content that:
1) Reflects current trends and interests of the target audience
2) Corresponds to the brand's tone and style of communication
3) Engages the audience and stimulates interaction

Use the following topics and keywords as a basis:
{keywords}

Consider the following business information:
{businessInfo}

Create {contentType} content with {tone} tone. The content should include a headline, main text, and hashtags.

Response format: clean HTML using <p>, <strong>, <em>, etc. tags for formatting. Use <br> for line breaks.
```

3. **For Source Search**:
```
You are an expert at finding high-quality Russian Instagram accounts.
Focus only on Instagram accounts with >50K followers that post in Russian.
For each account provide:
1. Username with @ symbol 
2. Full name in Russian
3. Follower count with K or M
4. Brief description in Russian

Format each account as:
1. **@username** - Name (500K followers) - Description
```

### Image Generation Process:
1. Translation of text prompts from Russian to English for better results
2. Using FAL AI API with fast-sdxl model by default
3. Parameters: width/height 1024x1024, number of images 1
4. Support for negative prompts to exclude unwanted elements
5. Processing API authorization errors with retry attempts

## Data Storage and Security Features

### Working with API Keys:
1. Storing API keys in the user's profile rather than in environment variables
2. Caching API keys on the server side to optimize requests
3. Prioritizing user keys over system keys
4. Key verification mechanism when initializing services

### Security:
1. Tokens are verified through authenticateUser middleware
2. Checking campaign existence before accessing related data
3. Validating request parameters before performing operations
4. Error handling with informative messages

## Business Logic and Data Flows

### Main Flows:
1. **Social Network Analysis**:
   - User adds sources to a campaign
   - System parses social networks and extracts trends
   - Trends are saved and ranked by metrics

2. **Content Generation**:
   - User selects trends/keywords
   - System generates content using AI
   - Content is saved with editing capabilities

3. **Publication Planning**:
   - User selects generated content
   - System adapts content for different platforms
   - Content is sent for publication via webhook

### Error Handling:
1. Checking API keys before executing requests
2. Informative error messages with details
3. User notifications through toast messages
4. Error logging on the server

## Interface Features

### Adaptive Design:
1. Mobile and desktop versions with different menu displays
2. Responsive grid for different screen sizes
3. Compact data tables with sorting and filtering capabilities

### Visual Components:
1. Cards for displaying trends and content
2. Modal windows for generation and editing
3. WYSIWYG editor for content with HTML support
4. Calendar for publication planning

## Limitations and Cautions

1. **API Access**:
   - Valid API keys are required for DeepSeek, Perplexity, FAL AI, and other services
   - The system should request keys from the user, not providing fictitious results

2. **Integrations**:
   - Authorization through Directus requires a valid URL and service availability
   - Webhook integrations require N8N setup with appropriate triggers

3. **Technical**:
   - Avoid modifying configuration files (vite.config.ts, package.json)
   - Do not use local database, all data interactions through Directus API
   - Follow the existing project structure

## Implementation Requirements

1. Must maintain the semantics and style of existing code
2. Use shadcn and tailwind for new components
3. Maintain typing using TypeScript
4. Code should be documented with comments (in Russian for the original project)
5. New functionality should integrate with the existing architecture
6. Consider multilingual interface (in this case - Russian language)

## Technical Recommendations for Implementation

1. Use React Query for all API requests
2. Set up optimistic UI updates for better UX
3. Implement infinite scroll for trend lists
4. Optimize image loading through proxy servers
5. Use caching for external API requests
6. Separate business logic and presentation in components

## Production Deployment

### Docker Integration
SMM Manager integrates into the infrastructure using Docker and Docker Compose as part of a larger system that includes:

1. **Traefik** - reverse proxy for routing and SSL certificates
2. **PostgreSQL** - central database for all services
3. **Directus** - project data storage and management
4. **N8N** - task automation and social media integration
5. **Appsmith** - low-code platform for internal applications
6. **Budibase** - platform for building business applications
7. **Redis**, **MinIO**, **CouchDB** - auxiliary services for Budibase

Complete docker-compose.yml configuration:

```yaml
services:
  # Traefik - reverse proxy for request routing and SSL
  traefik:
    image: "traefik:v3.3"
    restart: always
    command:
      - "--api=true"
      - "--api.insecure=true"
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.mytlschallenge.acme.tlschallenge=true"
      - "--certificatesresolvers.mytlschallenge.acme.email=${SSL_EMAIL}"
      - "--certificatesresolvers.mytlschallenge.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./traefik_data:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro

  # N8N - automation service for webhook processing and content publishing
  n8n:
    build:
      context: .
      dockerfile: Dockerfile-n8n
    restart: always
    depends_on:
      - postgres
    ports:
      - "127.0.0.1:5678:5678"
    labels:
      - traefik.enable=true
      - traefik.http.routers.n8n.rule=Host(`${SUBDOMAIN}.${DOMAIN_NAME}`)
      - traefik.http.routers.n8n.tls=true
      - traefik.http.routers.n8n.entrypoints=web,websecure
      - traefik.http.routers.n8n.tls.certresolver=mytlschallenge
      - traefik.http.middlewares.n8n.headers.SSLRedirect=true
      - traefik.http.middlewares.n8n.headers.STSSeconds=315360000
      - traefik.http.middlewares.n8n.headers.browserXSSFilter=true
      - traefik.http.middlewares.n8n.headers.contentTypeNosniff=true
      - traefik.http.middlewares.n8n.headers.forceSTSHeader=true
      - traefik.http.middlewares.n8n.headers.SSLHost=${DOMAIN_NAME}
      - traefik.http.middlewares.n8n.headers.STSIncludeSubdomains=true
      - traefik.http.middlewares.n8n.headers.STSPreload=true
      - traefik.http.routers.n8n.middlewares=n8n@docker
    environment:
      - N8N_HOST=${SUBDOMAIN}.${DOMAIN_NAME}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://${SUBDOMAIN}.${DOMAIN_NAME}/
      - GENERIC_TIMEZONE=${GENERIC_TIMEZONE}
      - DB_TYPE=postgresdb
      - DB_TABLE_PREFIX=n8n_
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_USER=postgres
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      - EXECUTIONS_DATA_MAX_AGE=168
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem
      - NODE_PATH=/home/node/.n8n/node_modules
      - NODE_FUNCTION_ALLOW_EXTERNAL=*  
    volumes:
      - ./n8n_data:/home/node/.n8n
      - ./local-files:/files

  # PostgreSQL - central database for storing Directus and N8N data
  postgres:
    image: postgres:16
    restart: always
    shm_size: 128mb
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - ./postgres:/var/lib/postgresql/data

  # PgAdmin - PostgreSQL administration interface
  pgadmin:
    image: dpage/pgadmin4
    restart: always
    depends_on:
      - postgres
    volumes:
      - ./pgadmin_data:/var/lib/pgadmin
    environment:
      - PGADMIN_DEFAULT_EMAIL=${SSL_EMAIL}
      - PGADMIN_DEFAULT_PASSWORD=${PASSWORD_PGADMIN}
    labels:
      - traefik.enable=true
      - traefik.http.routers.pgadmin.entrypoints=web,websecure
      - traefik.http.routers.pgadmin.tls=true
      - traefik.http.routers.pgadmin.rule=Host(`${PGADMIN_SUBDOMAIN}.${DOMAIN_NAME}`)
      - traefik.http.routers.pgadmin.tls.certresolver=mytlschallenge
      - traefik.http.services.pgadmin.loadbalancer.server.port=80

  # Directus - data management and user account system
  directus:
    image: directus/directus:latest
    restart: always
    depends_on:
      - postgres
    environment:
      - DB_CLIENT=pg
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_DATABASE=directus
      - DB_USER=postgres
      - DB_PASSWORD=${DIRECTUS_DB_PASSWORD}
      - ADMIN_EMAIL=${DIRECTUS_ADMIN_EMAIL}
      - ADMIN_PASSWORD=${DIRECTUS_ADMIN_PASSWORD}
      - CORS_ENABLED=true
      - CORS_ORIGIN=true
      - CORS_METHODS=GET,POST,PATCH,DELETE
      - CORS_ALLOWED_HEADERS=Content-Type,Authorization
      - CORS_EXPOSED_HEADERS=Content-Range
      - CORS_CREDENTIALS=true
      - CORS_MAX_AGE=18000
    volumes:
      - ./directus_data:/directus/uploads
    labels:
      - traefik.enable=true
      - traefik.http.routers.directus.rule=Host(`directus.${DOMAIN_NAME}`)
      - traefik.http.routers.directus.tls=true
      - traefik.http.routers.directus.entrypoints=web,websecure
      - traefik.http.routers.directus.tls.certresolver=mytlschallenge
      - traefik.http.services.directus.loadbalancer.server.port=8055

  # Appsmith - low-code platform for internal applications
  appsmith:
    image: appsmith/appsmith-ce
    restart: always
    depends_on:
      - postgres
    environment:
      - APPSMITH_ADMIN_EMAILS=${APPSMITH_ADMIN_EMAIL}
      - APPSMITH_ADMIN_PASSWORD=${APPSMITH_ADMIN_PASSWORD}
    volumes:
      - ./appsmith-stacks:/appsmith-stacks
    labels:
      - traefik.enable=true
      - traefik.http.routers.appsmith.rule=Host(`${APPSMITH_SUBDOMAIN}.${DOMAIN_NAME}`)
      - traefik.http.routers.appsmith.tls=true
      - traefik.http.routers.appsmith.entrypoints=web,websecure
      - traefik.http.routers.appsmith.tls.certresolver=mytlschallenge
      - traefik.http.services.appsmith.loadbalancer.server.port=80

  # Budibase - platform for building business applications
  budibase:
    image: budibase/budibase:latest
    restart: always
    depends_on:
      - postgres
      - redis
      - minio
      - couchdb
    environment:
      - MAIN_PORT=${MAIN_PORT}
      - BUDIBASE_ENVIRONMENT=PRODUCTION
      - API_ENCRYPTION_KEY=${API_ENCRYPTION_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
      - REDIS_URL=redis://default:${REDIS_PASSWORD}@redis:${REDIS_PORT}
      - COUCH_DB_URL=http://${COUCH_DB_USER}:${COUCH_DB_PASSWORD}@couchdb:5984
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - MINIO_URL=http://minio:9000
      - INTERNAL_API_KEY=${INTERNAL_API_KEY}
      - BB_ADMIN_USER_EMAIL=${BB_ADMIN_USER_EMAIL}
      - BB_ADMIN_USER_PASSWORD=${BB_ADMIN_USER_PASSWORD}
    volumes:
      - ./budibase_data:/app
    labels:
      - traefik.enable=true
      - traefik.http.routers.budibase.rule=Host(`${BUDIBASE_SUBDOMAIN}.${DOMAIN_NAME}`)
      - traefik.http.routers.budibase.tls=true
      - traefik.http.routers.budibase.entrypoints=web,websecure
      - traefik.http.routers.budibase.tls.certresolver=mytlschallenge
      - traefik.http.services.budibase.loadbalancer.server.port=${MAIN_PORT}

  # Redis for Budibase
  redis:
    image: redis:6
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - ./redis_data:/data

  # MinIO for Budibase
  minio:
    image: minio/minio
    restart: always
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=${MINIO_ROOT_USER}
      - MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
    volumes:
      - ./minio_data:/data

  # CouchDB for Budibase
  couchdb:
    image: couchdb:3
    restart: always
    environment:
      - COUCHDB_USER=${COUCH_DB_USER}
      - COUCHDB_PASSWORD=${COUCH_DB_PASSWORD}
    volumes:
      - ./couchdb_data:/opt/couchdb/data

  # SMM Manager - main application
  smm:
    build:
      context: ./smm
      dockerfile: Dockerfile
    restart: always
    volumes:
      - ./smm:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    command: npm run dev
    labels:
      - traefik.enable=true
      - traefik.http.routers.smm.rule=Host(`smm.omemo.tech`)
      - traefik.http.routers.smm.tls=true
      - traefik.http.routers.smm.entrypoints=web,websecure
      - traefik.http.routers.smm.tls.certresolver=mytlschallenge
      - traefik.http.services.smm.loadbalancer.server.port=5000
```

### Dockerfile for SMM Manager

```dockerfile
# Use current Node.js version
FROM node:18

# Set working directory
WORKDIR /app

# Install system dependencies via apt
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package*.json ./

# Clean existing node_modules and lock files for clean installation
RUN rm -rf node_modules package-lock.json

# Install dependencies
RUN npm install --no-audit --verbose

# Explicitly install react-draggable
RUN npm install react-draggable@4.4.6 --save --no-audit

# Verify library presence
RUN npm ls react-draggable

# Copy source code
COPY . .

# Export application port
EXPOSE 5000

# Command to build and run the application
CMD ["npm", "run", "dev"]
```

### Dockerfile for N8N

N8N requires its own container with specific settings:

```dockerfile
# Use official n8n image
FROM n8nio/n8n:latest

# Copy custom scripts or packages (if any)
COPY ./n8n-custom-scripts /home/node/.n8n/custom-scripts

# Install additional dependencies if needed
USER root
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    curl

# Install additional Node.js packages
RUN npm install -g \
    n8n-nodes-telegram \
    n8n-nodes-mysql \
    n8n-nodes-text-manipulation

# Return to unprivileged node user
USER node

# Components for working with SMM Manager
RUN mkdir -p /home/node/.n8n/nodes/local
COPY ./n8n-custom-nodes /home/node/.n8n/nodes/local

# Set environment variables
ENV N8N_HOST=n8n.nplanner.ru
ENV N8N_PROTOCOL=https
ENV NODE_ENV=production
ENV N8N_DIAGNOSTICS_ENABLED=false
ENV N8N_USER_MANAGEMENT_DISABLED=false

# Command to start n8n in server mode
CMD ["n8n", "start"]
```

### Environment Variables for Docker

For proper operation of the infrastructure in Docker, the following environment variables need to be configured in the `.env.docker` file:

```
# Main domain settings
DOMAIN_NAME=nplanner.ru
SUBDOMAIN=n8n
PGADMIN_SUBDOMAIN=pgadmin
APPSMITH_SUBDOMAIN=appsmith
BUDIBASE_SUBDOMAIN=budibase
SSL_EMAIL=admin@example.com

# Passwords
POSTGRES_PASSWORD=your_secure_postgres_password
PASSWORD_PGADMIN=your_secure_pgadmin_password

# Directus settings
DIRECTUS_DB_PASSWORD=your_secure_directus_db_password
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=your_secure_directus_admin_password

# Appsmith settings
APPSMITH_ADMIN_EMAIL=admin@example.com
APPSMITH_ADMIN_PASSWORD=your_secure_appsmith_password

# Budibase settings
MAIN_PORT=10000
API_ENCRYPTION_KEY=your_secure_api_encryption_key
JWT_SECRET=your_secure_jwt_secret
MINIO_ACCESS_KEY=your_minio_access_key
MINIO_SECRET_KEY=your_minio_secret_key
COUCH_DB_PASSWORD=your_couchdb_password
COUCH_DB_USER=your_couchdb_user
REDIS_PASSWORD=your_redis_password
INTERNAL_API_KEY=your_internal_api_key
REDIS_PORT=6379
BUDIBASE_ENVIRONMENT=PRODUCTION
MINIO_ROOT_USER=root
MINIO_ROOT_PASSWORD=your_secure_minio_root_password
BB_ADMIN_USER_EMAIL=admin@example.com
BB_ADMIN_USER_PASSWORD=your_secure_bb_admin_password

# Timezone settings
GENERIC_TIMEZONE=Europe/Moscow

# SMM Manager settings
DIRECTUS_URL=https://directus.nplanner.ru
```

### Running in Docker

To launch the complete infrastructure in Docker, you can use a special script (available in English and Russian):

```bash
# Make the script executable (choose your preferred language version)
chmod +x setup_infrastructure_en.sh # English version
chmod +x setup_infrastructure.sh    # Russian version

# Start the entire infrastructure
./setup_infrastructure_en.sh start  # English version
# or
./setup_infrastructure.sh start     # Russian version

# Stop the infrastructure
./setup_infrastructure_en.sh stop    # English version
./setup_infrastructure.sh stop       # Russian version

# Restart the infrastructure
./setup_infrastructure_en.sh restart # English version
./setup_infrastructure.sh restart    # Russian version

# View services status
./setup_infrastructure_en.sh status  # English version
./setup_infrastructure.sh status     # Russian version

# View logs of all services
./setup_infrastructure_en.sh logs    # English version
./setup_infrastructure.sh logs       # Russian version

# View logs of a specific service, for example, smm
./setup_infrastructure_en.sh logs smm # English version
./setup_infrastructure.sh logs smm    # Russian version
```

The script will automatically check for Docker, prepare the necessary directories and configuration files.

Alternatively, you can start the infrastructure manually:

```bash
# Create all necessary networks and containers
docker-compose up -d

# Check the status of services
docker-compose ps

# View logs of a specific service
docker-compose logs -f smm
```

### Language Support

The SMM Manager platform is designed with full bilingual support for both Russian and English languages:

- **Documentation**: All project documentation is available in both English and Russian versions, with files named accordingly (e.g., `detailed_project_prompt_en.md` for English and `detailed_project_prompt_ru.md` for Russian).
- **Infrastructure Scripts**: Setup and deployment scripts are available in both languages as well, with the English version having the `_en` suffix (e.g., `setup_infrastructure_en.sh` for English and `setup_infrastructure.sh` for Russian).
- **User Interface**: The application interface supports both languages with automatic detection based on browser settings. Users can also manually switch the language in the application settings.
- **API Documentation**: API endpoints are documented in both languages with consistent naming conventions.

When deploying the application, administrators can choose which language version of the scripts to use based on their preference.

### API Key Management

The SMM Manager platform uses several external AI and analytics services that require API keys for operation. These services include:

- **Perplexity API**: Used for content generation and keyword analysis
- **DeepSeek API**: Used for text generation and analysis of structured content
- **FAL.AI**: Used for image generation for social media content
- **Social Searcher API**: Used for searching and monitoring social media

API keys are managed through the Directus platform and are stored securely in the database. Users can set their API keys in the system through the admin panel. The system follows a priority scheme for API key usage:

1. User-specific API keys have the highest priority
2. System-wide API keys are used as a fallback when user keys are not available
3. Feature-specific keys can be set separately for each function

All API calls are proxied through the SMM Manager backend to ensure security and proper request formatting.

For local development and testing, API keys can be specified in the `.env` file, but for production deployment, it's recommended to configure them through the Directus admin interface.

## API Key Environment Variables

```
# AI Services
PERPLEXITY_API_KEY=your_perplexity_key
DEEPSEEK_API_KEY=your_deepseek_key
FAL_AI_API_KEY=your_fal_ai_key

# Social Media Analytics
SOCIAL_SEARCHER_API_KEY=your_social_searcher_key
```

This prompt contains all the necessary details to recreate the SMM Manager project, taking into account the existing architecture, constraints, and technical features.