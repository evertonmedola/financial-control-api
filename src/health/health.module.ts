import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

// Minimal shape (07-PATTERNS.md's adaptation note) — no providers/exports
// needed; HealthController is the only consumer of TerminusModule here.
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
