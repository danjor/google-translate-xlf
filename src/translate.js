const googleTranslate = require('@vitalets/google-translate-api');
const chalk = require('chalk');
const cloneDeep = require('lodash.clonedeep');
const convert = require('xml-js');
const Bottleneck = require('bottleneck/es5');
const tunnel = require('tunnel');
const log = require('./helpers/log');
const match = require('./helpers/text-matcher');
const date = require('./helpers/date');
const { xmlNormalize } = require('xml_normalize/dist/src/xmlNormalize');

/**
 * Translates an .xlf file from one language to another
 *
 * @param {string} input The source of the .xlf file, as a string
 * @param {string} from The language code of the input file
 * @param {string} to The language code of the output file
 *
 * @returns {string}
 */
async function translate(
    input,
    from,
    to,
    minTime,
    maxConcurrent,
    skip,
    proxy,
    autoProxy,
    clearState
) {
    const schema = {
        input,
        from,
        to,
        minTime,
        maxConcurrent,
        skip,
        proxy,
        autoProxy,
        clearState,
    };
    const xlfStruct = convert.xml2js(input);
    const limiter = new Bottleneck({
        maxConcurrent,
        minTime,
    });

    const elementsQueue = [];
    const targetsQueue = [];

    const isXlfV2 = xlfStruct.elements[0].attributes.version === '2.0';

    elementsQueue.push(xlfStruct);

    if (isXlfV2) {
        processXlfV2(elementsQueue, targetsQueue, schema);
    } else {
        processXlfV1(elementsQueue, targetsQueue, schema);
    }

    const allPromises = skip
        ? []
        : targetsQueue.map((el) =>
              limiter.schedule(() =>
                  getTextTranslation(el, from, to, skip, proxy, autoProxy)
              )
          );

    await Promise.all(allPromises);

    const xml = convert.js2xml(xlfStruct, {
        spaces: 2,
        // https://github.com/nashwaan/xml-js/issues/26#issuecomment-355620249
        attributeValueFn: function (value) {
            return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
    });

    let normalizedTarget = xmlNormalize({
        in: xml,
        trim: true,
        normalizeWhitespace: true,
        // no sorting for 'stableAppendNew' as this is the default merge behaviour:
        sortPath: undefined,
        removePath: undefined,
    });

    return {
        xml: normalizedTarget,
        numberOfTranslated: targetsQueue.length,
    };
}

const processXlfV1 = (elementsQueue, targetsQueue, schema) => {
    while (elementsQueue.length) {
        const elem = elementsQueue.shift();
        if (elem.name === 'file') {
            elem.attributes['target-language'] = schema.to;
            elem.attributes['date'] = date();
        }

        if (elem.name === 'trans-unit') {
            const source = elem.elements.find((el) => el.name === 'source');

            if (source) {
                let target = elem.elements.find((el) => el.name === 'target');

                if (!target || target.attributes?.state === 'new') {
                    if (!target) {
                        target = cloneDeep(source);
                        elem.elements.push(target);
                    }

                    const hasPlural = source.elements.some(
                        (el) => el.text?.indexOf('{VAR_PLURAL') >= 0
                    );
                    const hasText = target.elements.some((el) => el.type === 'text')
                    if (hasPlural || !hasText) {
                        if (schema.clearState && target?.attributes?.state) {
                            target.attributes.state = 'needs-translation';
                        }
                        continue;
                    }

                    const newTarget = cloneDeep(source);
                    target.elements = newTarget.elements;
                    target.name = 'target';

                    target.elements.forEach((el) => {
                        if (el.type === 'text' && !match(el.text)) {
                            if (
                                schema.clearState &&
                                target?.attributes?.state
                            ) {
                                target.attributes.state = 'translated';
                            }

                            if (schema.skip) {
                                el.text = '[INFO] Add your translation here';
                            } else {
                                targetsQueue.push(el);
                            }
                        }
                    });
                }
            }

            continue;
        }

        if (elem && elem.elements && elem.elements.length) {
            elementsQueue.push(...elem.elements);
        }
    }
};

const processXlfV2 = (elementsQueue, targetsQueue, schema) => {
    while (elementsQueue.length) {
        const elem = elementsQueue.shift();

        if (elem.name === 'xliff') {
            elem.attributes['trgLang'] = schema.to;
            elem.attributes['date'] = date();
        }

        if (elem.name === 'unit') {
            const segment = elem.elements.find((el) => el.name === 'segment');
            const source = segment.elements.find((el) => el.name === 'source');
            let target = segment.elements.find((el) => el.name === 'target');

            if (!target || segment.attributes?.state === 'initial') {
                if (!target) {
                    target = cloneDeep(source);
                    elem.elements.push(target);
                }

                const newTarget = cloneDeep(source);
                target.elements = newTarget.elements;
                target.name = 'target';

                const hasPlural = target.elements.some(
                    (el) => el.text?.indexOf('{VAR_PLURAL') >= 0
                );
                const hasText = target.elements.some((el) => el.type === 'text')
                if (hasPlural || !hasText) {
                    if (schema.clearState && segment?.attributes?.state) {
                        segment.attributes.state = 'needs-translation';
                    }
                    continue;
                }

                target.elements.forEach((el) => {
                    if (el.type === 'text' && !match(el.text)) {
                        if (schema.clearState && segment?.attributes?.state) {
                            segment.attributes.state = 'translated';
                        }

                        if (schema.skip) {
                            el.text = '[INFO] Add your translation here';
                        } else {
                            targetsQueue.push(el);
                        }
                    }
                });
            }

            continue;
        }

        if (elem && elem.elements && elem.elements.length) {
            elementsQueue.push(...elem.elements);
        }
    }
};

const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
};

async function getTextTranslation(el, from, to, skip, proxy, autoProxy) {
    let proxyConfig = {};

    if (proxy) {
        const [protocol, rest] = proxy.split('://');
        const [host, port] = rest.split(':');
        proxyConfig = {
            agent: tunnel.httpsOverHttp({
                proxy: {
                    host,
                    port,
                    headers: {
                        'User-Agent': 'Node',
                    },
                },
            }),
        };
    }
    if (autoProxy) {
        proxyConfig = {
            agent: tunnel.httpsOverHttp({
                proxy: {
                    host: '127.0.0.1',
                    port: '9000',
                    headers: {
                        'User-Agent': 'Node',
                    },
                },
            }),
        };
    }

    try {
        const result = await googleTranslate(
            el.text,
            { from, to },
            proxyConfig
        );

        if (el.text.charAt() === ' ' && result.text.charAt() !== ' ') {
            result.text = ' ' + result.text;
        }

        if (
            el.text.charAt(el.text.length - 1) === ' ' &&
            result.text.charAt(el.text.length - 1) !== ' '
        ) {
            result.text = result.text + ' ';
        }

        log(
            'Translating ' +
                chalk.yellow(el.text) +
                ' to ' +
                chalk.green(result.text)
        );
        el.text = result.text;
    } catch (err) {
        console.log(`[ERROR] ${JSON.stringify(err, getCircularReplacer())}`);
        console.log('[TRACE]', err.stack);
        el.text = '[WARN] Failed to translate';
    }
}

module.exports = translate;
