/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('rpa_task', 'session_mode');
  if (!hasColumn) {
    await knex.schema.alterTable('rpa_task', table => {
      table.string('session_mode').notNullable().defaultTo('taskUrlOnly');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('rpa_task', 'session_mode');
  if (hasColumn) {
    await knex.schema.alterTable('rpa_task', table => {
      table.dropColumn('session_mode');
    });
  }
};
