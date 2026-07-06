/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const existing = {};
  for (const column of [
    'extension_uid',
    'source_type',
    'manifest_version',
    'sha256',
    'permissions',
    'host_permissions',
    'repository_path',
    'current_path',
    'update_url_removed',
    'last_verified_at',
    'imported_at',
  ]) {
    existing[column] = await knex.schema.hasColumn('extension', column);
  }

  await knex.schema.alterTable('extension', table => {
    if (!existing.extension_uid) table.string('extension_uid').nullable();
    if (!existing.source_type) table.string('source_type').nullable();
    if (!existing.manifest_version) table.integer('manifest_version').nullable();
    if (!existing.sha256) table.string('sha256').nullable();
    if (!existing.permissions) table.json('permissions').nullable();
    if (!existing.host_permissions) table.json('host_permissions').nullable();
    if (!existing.repository_path) table.string('repository_path').nullable();
    if (!existing.current_path) table.string('current_path').nullable();
    if (!existing.update_url_removed) table.boolean('update_url_removed').defaultTo(false);
    if (!existing.last_verified_at) table.timestamp('last_verified_at').nullable();
    if (!existing.imported_at) table.timestamp('imported_at').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const columns = [
    'extension_uid',
    'source_type',
    'manifest_version',
    'sha256',
    'permissions',
    'host_permissions',
    'repository_path',
    'current_path',
    'update_url_removed',
    'last_verified_at',
    'imported_at',
  ];

  await knex.schema.alterTable('extension', table => {
    for (const column of columns) {
      table.dropColumn(column);
    }
  });
};
