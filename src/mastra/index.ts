
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { masterAgent } from './agents/masterAgent';
import { masterWorkflow } from './workflows/masterWorkflow';
import { chatAgent } from './agents/chat-agent';
import { orderAgent } from './agents/order-agent';
import { shopAgent } from './agents/shop-agent';
import { orderStatusAgent } from './agents/orderstatus-agent';

export const mastra = new Mastra({
  workflows: { masterWorkflow },
  agents: { weatherAgent, masterAgent, chatAgent, orderAgent, shopAgent, orderStatusAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
