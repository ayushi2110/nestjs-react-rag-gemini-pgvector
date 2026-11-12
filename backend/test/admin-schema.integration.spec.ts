import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { Pool, PoolClient } from "pg";

const databaseTest = process.env.TEST_DATABASE_URL ? describe : describe.skip;

databaseTest("admin auth schema", () => {
  let pool: Pool;
  let client: PoolClient | undefined;
  const schema = `auth_test_${randomUUID().replace(/-/g, "")}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const migration = await readFile(
      resolve(__dirname, "../../database/migrations/001_admin_auth.sql"),
      "utf8",
    );
    await client.query(migration);
  });

  afterAll(async () => {
    if (client) {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
    await pool.end();
  });

  it("enforces the singleton admin constraint", async () => {
    await client!.query(
      `INSERT INTO admin_accounts (id, email, password_hash)
       VALUES (1, 'first@example.test', 'argon2id-test-hash')`,
    );

    await expect(
      client!.query(
        `INSERT INTO admin_accounts (id, email, password_hash)
         VALUES (2, 'second@example.test', 'argon2id-test-hash')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client!.query(
        `INSERT INTO admin_accounts (id, email, password_hash)
         VALUES (1, 'second@example.test', 'argon2id-test-hash')`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
