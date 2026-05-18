import express from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { featureFlagsRouter } from './routes/feature-flags';
import { registerFalAiImageRoutes } from "./routes-fal-ai-images";
import { registerClaudeRoutes } from "./routes-claude";
import { registerDeepSeekRoutes } from "./routes-deepseek";
import { registerDeepSeekModelsRoute } from "./routes-deepseek-models";
import { registerQwenRoutes } from "./routes-qwen";
import { registerGeminiRoutes } from "./routes-gemini";
import { registerBegetS3Routes } from "./routes-beget-s3";
import { registerUserApiKeysRoutes } from "./routes-user-api-keys";
import { registerGlobalApiKeysRoutes } from './routes-global-api-keys';
import youtubeAuthRouter from './routes/youtube-auth';
import youtubeSettingsRouter from './routes/campaign-youtube-settings';
import { healthRouter } from './routes/health';

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());

// Minimal registration for tests to work
app.use('/api', healthRouter);
app.use('/api', featureFlagsRouter);
registerGlobalApiKeysRoutes(app);
registerUserApiKeysRoutes(app);
app.use('/api', youtubeAuthRouter);
app.use('/api', youtubeSettingsRouter);

registerClaudeRoutes(app);
registerDeepSeekRoutes(app);
registerDeepSeekModelsRoute(app);
registerQwenRoutes(app);
registerGeminiRoutes(app);
registerFalAiImageRoutes(app);
registerBegetS3Routes(app);

registerRoutes(app);

export { app };
