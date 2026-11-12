import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AuthService } from "./auth.service";

async function seedAdmin() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    await app.get(AuthService).provisionInitialAdmin();
  } finally {
    await app.close();
  }
}

seedAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unexpected bootstrap failure.";
  console.error(`Admin bootstrap failed: ${message}`);
  process.exitCode = 1;
});
