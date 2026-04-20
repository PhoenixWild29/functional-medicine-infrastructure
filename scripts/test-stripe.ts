import Stripe from 'stripe'

async function main() {
  const stripe = new Stripe(process.env['STRIPE_SECRET_KEY']!)

  try {
    const pi = await stripe.paymentIntents.create({
      amount: 21000,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { test: 'poc-validation' },
    })
    console.log('SUCCESS:', pi.id, pi.status)
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error('STRIPE ERROR:', err.message)
      // @ts-expect-error — Stripe error objects extend Error with .type/.code at runtime
      console.error('Type:', err.type)
      // @ts-expect-error — Stripe error objects extend Error with .type/.code at runtime
      console.error('Code:', err.code)
    }
  }
}

main()
