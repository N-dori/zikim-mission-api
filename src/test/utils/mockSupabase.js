function makeSupabaseMock(opts = {}) {
  // opts can be a default result object, or an object with selectResult/insertResult/updateResult,
  // or a mapping per table: { tables: { users: { selectResult: ..., insertResult: ... } } }
  const captured = { insertArgs: null, updateArgs: null }

  function resultFor(table, kind) {
    const tableMap = (opts.tables && opts.tables[table]) || opts[table] || opts
    if (tableMap && typeof tableMap === 'object') {
      const key = kind + 'Result'
      if (tableMap[key] !== undefined) return tableMap[key]
      // if tableMap looks like a simple result object (has data/error), return it
      if (tableMap.data !== undefined || tableMap.error !== undefined) return tableMap
    }
    // fallback to top-level named results
    if (opts[kind + 'Result'] !== undefined) return opts[kind + 'Result']
    // final fallback
    return { data: [], error: null }
  }

  function makeThenable(val) {
    return {
      then(onFulfilled, onRejected) {
        return Promise.resolve(val).then(onFulfilled, onRejected)
      }
    }
  }

  function from(table) {
    const selectResult = resultFor(table, 'select')
    const insertResult = resultFor(table, 'insert')
    const updateResult = resultFor(table, 'update')

    return {
      select(/* ...args */) {
        const payload = selectResult
        return Object.assign({
          eq() {
            return {
              limit() { return Promise.resolve(payload) },
              single() { return Promise.resolve(payload) },
              then(onFulfilled, onRejected) { return Promise.resolve(payload).then(onFulfilled, onRejected) }
            }
          }
        }, makeThenable(payload))
      },
      insert(arr) {
        captured.insertArgs = arr
        const payload = insertResult
        return Object.assign(makeThenable(payload), {
          select() { return { single() { return Promise.resolve(payload) } } }
        })
      },
      update(obj) {
        captured.updateArgs = obj
        const payload = updateResult
        return Object.assign({
          eq() {
            return Object.assign(makeThenable(payload), { select() { return { single() { return Promise.resolve(payload) } } } })
          }
        }, makeThenable(payload))
      }
    }
  }

  return { from, captured }
}

module.exports = { makeSupabaseMock }
