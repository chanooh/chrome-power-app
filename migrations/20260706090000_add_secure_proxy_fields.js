/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasHost = await knex.schema.hasColumn('proxy', 'host');
  const hasPort = await knex.schema.hasColumn('proxy', 'port');
  const hasUsername = await knex.schema.hasColumn('proxy', 'username');
  const hasPasswordEncrypted = await knex.schema.hasColumn('proxy', 'password_encrypted');
  const hasCredentialsMigratedAt = await knex.schema.hasColumn('proxy', 'credentials_migrated_at');

  await knex.schema.alterTable('proxy', table => {
    if (!hasHost) table.string('host').nullable();
    if (!hasPort) table.string('port').nullable();
    if (!hasUsername) table.string('username').nullable();
    if (!hasPasswordEncrypted) table.text('password_encrypted').nullable();
    if (!hasCredentialsMigratedAt) table.timestamp('credentials_migrated_at').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const columns = [
    'host',
    'port',
    'username',
    'password_encrypted',
    'credentials_migrated_at',
  ];

  await knex.schema.alterTable('proxy', table => {
    for (const column of columns) {
      table.dropColumn(column);
    }
  });
};
