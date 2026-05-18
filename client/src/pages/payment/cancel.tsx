import { Link } from 'wouter';
import { XCircle, ArrowLeft, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentCancelPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-950 dark:to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
          <XCircle className="w-10 h-10 text-red-500" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Оплата отменена
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Деньги не были списаны. Вы можете вернуться к выбору тарифа в любое время.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/pricing">
            <Button className="w-full bg-blue-600 hover:bg-blue-700" data-testid="button-back-to-pricing">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Вернуться к тарифам
            </Button>
          </Link>
          <a href="https://t.me/omemo_support" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="w-full" data-testid="button-contact-support-cancel">
              <LifeBuoy className="w-4 h-4 mr-2" />
              Помощь при оплате
            </Button>
          </a>
        </div>

        <p className="text-xs text-gray-400">
          Возникли проблемы?{' '}
          <a href="mailto:support@omemo.tech" className="underline hover:text-gray-600">
            support@omemo.tech
          </a>
        </p>
      </div>
    </div>
  );
}
