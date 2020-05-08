import * as debug from 'debug'

function devLogger(namespace, tag) {
  return {
    info: debug(namespace + '/' + tag + ':info'),
    warn: debug(namespace + '/' + tag + ':warn'),
    debug: debug(namespace + '/' + tag + ':debug'),
    error: debug(namespace + '/' + tag + ':error')
  }
}

function prodLogger() {
  return {
    info: () => {
    },
    debug: () => {
    },
    warn: console.warn,
    error: console.error
  }
}

// const log = process.env.NODE_ENV === 'development' ? devLogger : prodLogger
const log = devLogger
// if (process.env.NODE_ENV === 'development') {
localStorage.debug = 'tc-class-core*:*,tc-class-web*:*'
// }
export {
  log
}


export default function (Vue, options) {
  Vue.mixin({
    created: function () {
      const {appName} = options || {}
      this.$logger = log(appName || 'VueApp', this.$options.__file)
    }
  })
}

/**
 *
 * @returns {string|*}
 * @param lengthAry[Array]
 * @param ss
 */
export function tablizeString(lengthAry, ...ss) {
  return ss.map((arg, idx) => {
    let str
    try {
      str = typeof arg === 'string' ? arg : arg.toString()
    } catch (e) {
      debugger
    }
    let length = lengthAry[idx] || lengthAry[lengthAry.length - 1]
    let res = str
    const strLength = str.length
    if (length === -1) {
    } else if (strLength > length) {
      res = str.slice(0, length - 3) + '...'
    } else {
      const whiteSpaceLength = Math.ceil((length - str.length) / 2)
      for (let i = 0; i < whiteSpaceLength; i++) {
        res = ' ' + res
      }
      while (res.length < length) {
        res += ' '
      }
    }
    return res
  }).join('|')

}
