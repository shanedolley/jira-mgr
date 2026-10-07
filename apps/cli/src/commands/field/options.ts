import { getFieldOptions, type FieldOption, type FieldOptionField } from '@jira-mgr/core/lookups'

import type { Handler } from '../../context.js'
import { renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** `jm field options <field>`: the values a field accepts in the project. */
export const options: Handler<SpecOf<'field options'>, FieldOption[]> = {
  async run({ field }, ctx) {
    // The spec's choices are the field names, so the parser has matched one.
    const name = field === 'issue-type' ? 'issueType' : (field as FieldOptionField)
    const values = await getFieldOptions(ctx.http(), name)
    if (values.length === 0 && !ctx.json) ctx.io.stderr.write('No values.\n')
    return values
  },

  render: (values, tty) =>
    values.length === 0
      ? ''
      : renderTable(
          tty,
          [{ header: 'ID' }, { header: 'NAME' }],
          values.map((v) => [v.id, v.name]),
        ),
}
