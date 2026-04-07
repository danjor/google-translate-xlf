const expect = require('chai').expect;
const proxyquire = require('proxyquire');
const convert = require('xml-js');

describe('translate 429 error handling', () => {
    it('stops translating when 429 error occurs and does not set [WARN]', async () => {
        let callCount = 0;
        const translate = proxyquire('../src/translate', {
            '@vitalets/google-translate-api': (text) => {
                callCount++;
                if (text === 'Stop me') {
                    const error = new Error('Too Many Requests');
                    error.statusCode = 429;
                    error.name = 'HTTPError';
                    // The issue description says: [TRACE] HTTPError: Response code 429 (Too Many Requests)
                    // It looks like it might be from 'got' or similar library used by google-translate-api
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
                        <trans-unit id="2"><source>Stop me</source></trans-unit>
                        <trans-unit id="3"><source>Should not be called</source></trans-unit>
                    </body>
                </file>
            </xliff>
        `;

        const result = await translate(input, 'en', 'fr', 0, 1, false);
        const jsResult = convert.xml2js(result.xml, { compact: true });
        
        const transUnits = jsResult.xliff.file.body['trans-unit'];
        
        // Check first one is translated
        expect(transUnits[0].target._text).to.equal('Good_TRANSLATED');
        
        // Check second one (the one that failed with 429)
        // According to issue, it should NOT be '[WARN] Failed to translate'
        // In current implementation it will be '[WARN] Failed to translate'
        // After fix it should remain the original text (which is copied from source)
        expect(transUnits[1].target._text).to.not.equal('[WARN] Failed to translate');
        expect(transUnits[1].target._text).to.equal('Stop me');

        // Check third one was not translated (because we stopped)
        expect(transUnits[2].target._text).to.equal('Should not be called');
        
        // We expect at most 2 calls to googleTranslate if it stops after the error
        // Actually, if we use Bottleneck, it might have already scheduled the next one if maxConcurrent > 1
        // But here we use maxConcurrent: 1
        expect(callCount).to.be.at.most(2);
    });
});
