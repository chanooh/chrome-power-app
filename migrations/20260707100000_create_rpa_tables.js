/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTask = await knex.schema.hasTable('rpa_task');
  if (!hasTask) {
    await knex.schema.createTable('rpa_task', table => {
      table.increments('id').primary().unique();
      table.string('name').notNullable();
      table.text('description').nullable();
      table.json('flow_json').notNullable();
      table.integer('default_concurrency').defaultTo(1);
      table.integer('default_timeout_ms').defaultTo(30000);
      table.integer('default_retry').defaultTo(0);
      table.string('screenshot_policy').defaultTo('on-failure');
      table.string('close_policy').defaultTo('keepOpen');
      table.json('variables_json').nullable();
      table.text('sensitive_variables_encrypted').nullable();
      table.integer('status').defaultTo(1);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(null).nullable();
    });
  }

  const hasTaskProfile = await knex.schema.hasTable('rpa_task_profile');
  if (!hasTaskProfile) {
    await knex.schema.createTable('rpa_task_profile', table => {
      table.increments('id').primary().unique();
      table.integer('task_id').notNullable();
      table.integer('window_id').notNullable();
      table.json('variables_json').nullable();
      table.text('sensitive_variables_encrypted').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.unique(['task_id', 'window_id']);
    });
  }

  const hasRun = await knex.schema.hasTable('rpa_run');
  if (!hasRun) {
    await knex.schema.createTable('rpa_run', table => {
      table.increments('id').primary().unique();
      table.integer('task_id').notNullable();
      table.string('status').notNullable().defaultTo('queued');
      table.integer('total_profiles').defaultTo(0);
      table.integer('succeeded_profiles').defaultTo(0);
      table.integer('failed_profiles').defaultTo(0);
      table.string('artifact_root').nullable();
      table.json('options_json').nullable();
      table.text('message').nullable();
      table.timestamp('started_at').defaultTo(null).nullable();
      table.timestamp('finished_at').defaultTo(null).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(null).nullable();
    });
  }

  const hasRunProfile = await knex.schema.hasTable('rpa_run_profile');
  if (!hasRunProfile) {
    await knex.schema.createTable('rpa_run_profile', table => {
      table.increments('id').primary().unique();
      table.integer('run_id').notNullable();
      table.integer('task_id').notNullable();
      table.integer('window_id').notNullable();
      table.string('profile_id').nullable();
      table.string('status').notNullable().defaultTo('queued');
      table.integer('current_step_index').defaultTo(0);
      table.string('artifact_dir').nullable();
      table.text('error').nullable();
      table.timestamp('started_at').defaultTo(null).nullable();
      table.timestamp('finished_at').defaultTo(null).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(null).nullable();
    });
  }

  const hasRunStep = await knex.schema.hasTable('rpa_run_step');
  if (!hasRunStep) {
    await knex.schema.createTable('rpa_run_step', table => {
      table.increments('id').primary().unique();
      table.integer('run_id').notNullable();
      table.integer('run_profile_id').notNullable();
      table.integer('task_id').notNullable();
      table.integer('window_id').notNullable();
      table.string('step_id').notNullable();
      table.integer('step_index').notNullable();
      table.string('step_type').notNullable();
      table.string('status').notNullable().defaultTo('queued');
      table.integer('attempt').defaultTo(0);
      table.integer('duration_ms').defaultTo(0);
      table.text('message').nullable();
      table.text('error').nullable();
      table.string('artifact_path').nullable();
      table.json('output_json').nullable();
      table.timestamp('started_at').defaultTo(null).nullable();
      table.timestamp('finished_at').defaultTo(null).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(null).nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('rpa_run_step');
  await knex.schema.dropTableIfExists('rpa_run_profile');
  await knex.schema.dropTableIfExists('rpa_run');
  await knex.schema.dropTableIfExists('rpa_task_profile');
  await knex.schema.dropTableIfExists('rpa_task');
};
