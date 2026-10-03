import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

export const DATABASE_POOL = "DATABASE_POOL";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>("DATABASE_URL"),
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        });

        pool.on("error", (err) => {
          console.error("[DatabasePool] Unexpected pool error:", err);
        });

        return pool;
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
