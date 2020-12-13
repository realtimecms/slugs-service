const utils = require("../utils.js")

/// TODO: think about updates

module.exports = function(service, cms) {
  for(let actionName in service.actions) {
    const action = service.actions[actionName]

    if(!action.slug) continue;
    const { from, field, hard, group } = action.slug

    const oldExec = action.execute
    action.execute = async (...args) => {
      let data = args[0]

      if(!data[field]) {
        data[field] = await service.triggerService('slugs', {
          type: "CreateSlug",
          group,
          title: data[from]
        })
      } else {
        if(hard) {
          try {
            await service.triggerService('slugs', {
              type: "TakeSlug",
              group,
              path: data.slug
            })
          } catch (e) {
            let properties = {}
            properties[field] = "taken"
            throw {properties}
          }
        } else {
          data[field] = await service.triggerService('slugs', {
            type: "CreateSlug",
            group,
            path: data.slug
          })
        }
      }

      return oldExec.apply(action, args)
    }
  }
}