import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  async headers(){return [{source:'/research-upload/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'},{key:'X-Content-Type-Options',value:'nosniff'}]}];},
  turbopack: { root: process.cwd() },
  distDir: process.env.FINAL_FORE_TEST_BUILD === '1' ? '.next-local-test' : '.next',
  outputFileTracingIncludes: {
    '/*': ['./data/vendor-reference.json', './epic3/web/**/*', './epic3/reporting/web/*.html', './epic3/reporting/web/*.css', './epic3/reporting/web/*.js', './epic3/*catalog.json', './epic3/*options.json', './epic3/order-template.json'],
  },
};
export default config;
