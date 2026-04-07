const expect = require('chai').expect;
const proxyquire = require('proxyquire');
const convert = require('xml-js');

describe('translate general error handling', () => {
    it('does not set [WARN] and keeps original text when a general error occurs', async () => {
        const translate = proxyquire('../src/translate', {
            '@vitalets/google-translate-api': (text) => {
                if (text === 'Fail me') {
                    const error = new Error('General Error');
                    error.statusCode = 500;
                    return Promise.reject(error);
                }
                return Promise.resolve({ text: text + '_TRANSLATED' });
            },
            './helpers/log': () => {}
        });

        const input = `
            <?xml version="1.0" encoding="UTF-8" ?>
            <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
                <file source-language="en" datatype="plaintext" original="ng2.template">
                    <body>
                        <trans-unit id="1"><source>Good</source></trans-unit>
                        <trans-unit id="2"><source>Fail me</source></trans-unit>
                    </body>
                </file>
            </xliff>
        `;

        const result = await translate(input, 'en', 'fr', 0, 1, false, null, false, true);
        const jsResult = convert.xml2js(result.xml, { compact: true });
        
        const transUnits = jsResult.xliff.file.body['trans-unit'];
        
        // Check first one is translated
        expect(transUnits[0].target._text).to.equal('Good_TRANSLATED');
        
        // Check second one (the one that failed)
        // It should NOT be '[WARN] Failed to translate'
        // It should remain 'Fail me'
        expect(transUnits[1].target._text).to.not.equal('[WARN] Failed to translate');
        expect(transUnits[1].target._text).to.equal('Fail me');

        // Check state - it should NOT be 'translated' if it failed
        // For Xliff 1.2, state is usually on the target element or trans-unit.
        // In this project, it seems to be on target.attributes.state
        if (transUnits[1].target._attributes) {
            expect(transUnits[1].target._attributes.state).to.not.equal('translated');
        } else {
            // If there are no attributes, it's definitely not 'translated'
            expect(transUnits[1].target._attributes).to.be.undefined;
        }
    });
});
