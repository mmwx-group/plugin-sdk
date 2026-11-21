import './style.css'
import { useState } from 'react'
import { definePlugin, toast, ui, useApi, useT } from '@mmwx/plugin-sdk'

const { Button, Card, CardContent, CardHeader, CardTitle } = ui

function useHello() {
  const api = useApi()
  const [data, setData] = useState(null)
  const load = async () => {
    try {
      setData(await api.get('hello'))
    } catch (e) {
      toast.error(String(e?.message || e))
    }
  }
  return [data, load]
}

function HomePage() {
  const t = useT()
  const [data, load] = useHello()
  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>{t('intro')}</p>
      <Button onClick={load}>{t('say')}</Button>
      {data && (
        <p className='plugin-{{id}}-result'>
          {data.message} · {t('hits', { n: data.hits })}
        </p>
      )}
    </div>
  )
}

function DashboardCard() {
  const t = useT()
  const [data, load] = useHello()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('card')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <Button size='sm' variant='outline' onClick={load}>
          {t('say')}
        </Button>
        {data && <p className='text-sm'>{data.message}</p>}
      </CardContent>
    </Card>
  )
}

export default definePlugin({
  activate(ctx) {
    ctx.pages.register('home', HomePage)
    ctx.slots.add('dashboard.card', { id: 'hello', component: DashboardCard, size: 'third' })
  },
})
