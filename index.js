const App = require("@live-change/framework")
const validators = require("../validation")
const app = new App()

require('../../i18n/ejs-require.js')
const i18n = require('../../i18n')

const definition = app.createServiceDefinition({
  name: 'slugs',
  eventSourcing: true,
  validators
})

const randomLettersBig = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const randomLettersSmall = 'abcdefghijklmnopqrstuvwxyz'
const randomDigits = '0123456789'
const charsets = {
  'all' :  randomLettersBig + randomLettersSmall + randomDigits,
  'digits': randomDigits,
  'letters': randomLettersSmall + randomLettersBig,
  'smallLetters': randomLettersSmall,
  'bigLetters': randomLettersBig,
  'small': randomLettersSmall + randomDigits,
  'big': randomLettersBig + randomDigits,
}

const defaultRandomPathLength = 5

const Slug = definition.model({
  name: "Slug",
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    path: {
      type: String,
      validation: ['nonEmpty']
    },
    to: {
      type: String
    }
  },
  indexes: {
    slugByPath: {
      property: ["group", "path"]
    },
  },
  crud: {
    deleteTrigger: true,
    writeOptions: {
      access: (params, {client, service}) => {
        return client.roles.includes('admin')
      }
    },
    id: ({group, path}) => `${group}_${path}`
  }
})

definition.view({
  name: "slugByPath",
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    path: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Slug
  },
  daoPath({ group, path }, { client, service }, method) {
    return Slug.path(`${group}_${path}`)
  }
})


definition.event({
  name: "SlugCreated",
  async execute({ slug, group, path, to, redirect }) {
    await Slug.create({ id: slug, group, path, to, redirect })
  }
})

definition.event({
  name: "SlugDeleted",
  async execute({ slug }) {
    await Slug.delete(slug)
  }
})

definition.trigger({
  name: 'CreateSlug',
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    title: {
      type: String
    },
    path: {
      type: String,
    },
    to: {
      type: String
    },
    maxLength: {
      type: Number
    },
    redirect: {
      type: String
    },
    charset: {
      type: String
    },
    prefix: {
      type: String
    },
    suffix: {
      type: String
    },
    length: {
      type: Number
    }
  },
  queuedBy: 'group',
  async execute (props, { client, service }, emit) {
    console.log("SLUG CREATE", props)
    if(!props.to && !props.redirect) throw new Error("slug must have field 'to' or 'redirect'")
    const prefix = props.prefix || ''
    const suffix = props.suffix || ''
    const randomCharacters = props.charset ? charsets[props.charset] : charsets.all
    let randomPathLength = props.length || defaultRandomPathLength
    const group = props.group
    let maxLength = props.maxLength || 125
    maxLength -= group.length
    const sufixLength = 15
    let path = ''
    let random = false
    if(props.path) {
      path = path
      const cutLength = maxLength - sufixLength/// because max id size
      if (path.length > cutLength) {
        let lastSep = path.lastIndexOf('-')
        if(lastSep > cutLength - 40) path = path.slice(0, lastSep)
          else path = path.slice(0, cutLength)
      }
    } else {
      if (props.title) { // generated from title
        path = props.title
        path = path.replace(/[@]+/g, '-at-')
        path = path.replace(/[_/\\\\ -]+/g, '-')
        path = path.replace(/[^a-z0-9-]+/gi, '')
        const cutLength = maxLength - sufixLength /// because max id size
        while (path.length > cutLength) {
          let lastSep = path.lastIndexOf('-')
          if (lastSep > cutLength - 40) path = path.slice(0, lastSep)
            else path = path.slice(0, cutLength)
        }
      } else { // random
        random = true
        const charactersLength = randomCharacters.length
        for(let i = 0; i < randomPathLength; i++) {
          path += randomCharacters.charAt(Math.floor(Math.random() * charactersLength))
        }
      }
    }
    const basePath = path

    let created = false
    let conflict = false
    do {
      console.log("TRYING PATH", prefix + path + suffix)
      const res = await Slug.get(`${group}_${prefix + path + suffix}`)
      if(res == null) { // TODO: add some locks!?!
        Slug.create({ id: `${group}_${path}`, group, path: prefix + path + suffix, to: props.to || null })
        created = true
      } else {
        console.log("PATH TAKEN", prefix + path + suffix)

        if(path.length >= maxLength) { /// because max id size
          if(random) {
            const charactersLength = randomCharacters.length
            path = ''
            for(let i = 0; i < randomPathLength; i++) {
              path += randomCharacters.charAt(Math.floor(Math.random() * charactersLength))
            }
          } else {
            path = basePath
          }
          const cutLength = maxLength - 10
          if(path.length > cutLength) {
            let lastSep = path.lastIndexOf('-')
            if(lastSep > cutLength - 40) path = path.slice(0, lastSep)
            else path = path.slice(0, cutLength)
          }
        }

        if(!conflict) path += '-'
        conflict = true
        path += randomCharacters.charAt(Math.floor(Math.random() * randomCharacters.length))
      }
    } while(!created)

    emit({
      type: 'SlugCreated',
      slug: `${group}_${prefix + path + suffix}`,
      to: props.to || null,
      redirect: props.redirect || null,
      group, path
    })

    return prefix + path + suffix
  }
})


definition.trigger({
  name: 'TakeSlug',
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    path: {
      type: String,
      validation: ['nonEmpty']
    },
    to: {
      type: String
    },
    redirect: {
      type: Boolean
    }
  },
  queuedBy: 'group',
  async execute (props, { client, service }, emit) {
    if(!props.to && !props.redirect) throw new Error("slug must have field 'to' or 'redirect'")
    const group = props.group
    const path = props.path
    const res = await Slug.get(`${group}_${path}`)
    if(res) throw new Error("taken")

    Slug.create({id: `${group}_${path}`, group, path, to: props.to || null})

    emit({
      type: 'SlugCreated',
      slug: `${group}_${path}`,
      to: props.to || null,
      redirect: props.redirect || null,
      group, path
    })

    return path
  }
})

definition.trigger({
  name: 'RedirectSlug',
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    path: {
      type: String,
      validation: ['nonEmpty']
    },
    to: {
      type: String
    },
    redirect: {
      type: Boolean
    }
  },
  queuedBy: 'group',
  async execute (props, { client, service }, emit) {
    if(!props.to && !props.redirect) throw new Error("slug must have field 'to' or 'redirect'")
    const group = props.group
    const path = props.path
    const res = await Slug.get(`${group}_${path}`)
    if(!res) throw new Error("not_found")

    Slug.create({id: `${group}_${path}`, group, path, to: props.to || null})

    emit({
      type: 'SlugCreated',
      slug: `${group}_${path}`,
      to: props.to || null,
      redirect: props.redirect || null,
      group, path
    })

    return path
  }
})

definition.trigger({
  name: 'ReleaseSlug',
  properties: {
    group: {
      type: String,
      validation: ['nonEmpty']
    },
    path: {
      type: String,
      validation: ['nonEmpty']
    },
    to: {
      type: String
    }
  },
  queuedBy: 'group',
  async execute (props, { client, service }, emit) {
    const group = props.group
    const path = props.path

    emit({
      type: 'SlugDeleted',
      slug: `${group}_${path}`
    })

    return null
  }
})

module.exports = definition

async function start () {
  app.processServiceDefinition(definition, [...app.defaultProcessors])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch(error => {
  console.error(error)
  process.exit(1)
})


