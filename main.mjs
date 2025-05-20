import { defineCommand, runMain } from 'citty'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

import 'dotenv/config'

const main = defineCommand({
  meta: {
    name: 'supabase-ssr-user-impersonate-tool',
    version: '1.0.0',
    description: 'Provide an email address and get a JS snippet that you can run in the browser on the site to impersonate the user.',
  },
  args: {
    email: {
      description: 'Email address of the user to impersonate.',
      required: true,
    },
    'skip-check': {
      description: 'Bypass the user existence check before proceeding. A new account will be created if a user with the given email does not exist.',
      required: false,
    },
    'dry-run': {
      description: 'Skip generating a login request.',
      required: false,
    },
  },
  async run({ args }) {
    const { email } = args

    const supabase_url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabase_anon_key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const service_role_key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabase_url || !supabase_anon_key || !service_role_key) {
      console.error('Please set the SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY environment variables in `.env`.')
      process.exit(1)
    }

    const supabase = createClient(supabase_url, service_role_key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })


    // Step 0: Check if the user exists

    if (!args['skip-check']) {
      const { data: usersData, error: userError } = await supabase.from('users')
        .select('*')
        .eq('email', email);

      if (userError) {
        console.error('Error checking user existence:', userError)
        console.error('If you do not have a `users` table under the public schema with an `email` column, please use the --skip-check flag to bypass this check.')
        process.exit(1)
      }

      const user = usersData[0]
      if (!user) {
        console.error(`User with email ${email} does not exist. Use --skip-check to bypass this check and let a new account be created automatically with the given email.`)
        process.exit(1)
      }

      console.log(`// Email: ${email}`)
      console.log(`// User ID: ${user.id}`)
    }

    if (args['dry-run']) {
      process.exit(0)
    }


    // Step 1: Generate a magic link

    const { data, error: generateLinkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    })

    if (generateLinkError) {
      console.error('Error generating magic link:', generateLinkError)
      process.exit(1)
    }

    const hashed_token = data.properties.hashed_token


    // Step 2: Get cookies using the magic link
    // See: https://web.archive.org/web/20240115184440/https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr

    const cookies = {}

    const serverSupabase = createServerClient(
      supabase_url,
      supabase_anon_key,
      {
        cookies: {
          get(name) {
            return undefined
          },
          set(name, value, options) {
            cookies[name] = { value, options }
          },
          remove(name, options) {
            // console.log(`Removed cookie ${name} with options`, options)
          },
        },
      }
    )

    const { error } = await serverSupabase.auth.verifyOtp({
      type: 'email',
      token_hash: hashed_token,
    })

    if (error) {
      console.error('Error getting cookie from magic link hashed token:', error)
      process.exit(1)
    }

    const jsSnippetInstructions = [
      '// Please execute this JS snippet above on the site and refresh the page.',
      '// You may need to manually clear the cookies in your browser before executing this snippet if it did not work.',
    ].join('\n')

    console.log('')
    console.log(jsSnippetInstructions)
    console.log('')
    console.log(`
(() => {
  const cookies = ${JSON.stringify(cookies)}

  function writeCookies(cookies) {
    for (var name in cookies) {
      if (!cookies.hasOwnProperty(name)) continue;

      var entry = cookies[name];
      var value = entry.value;
      var options = entry.options;

      var cookieString = encodeURIComponent(name) + "=" + encodeURIComponent(value);

      if (options.maxAge !== undefined) {
        cookieString += "; max-age=" + options.maxAge;
      }

      if (options.path) {
        cookieString += "; path=" + options.path;
      }

      if (options.sameSite) {
        cookieString += "; samesite=" + options.sameSite;
      }

      document.cookie = cookieString;
    }
  }

  writeCookies(cookies)
})()
`.trim())
    console.log('')
    console.log(jsSnippetInstructions)
  },
})

runMain(main)
