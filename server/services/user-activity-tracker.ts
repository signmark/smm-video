import { DirectusCrud } from './directus-crud.js';

export class UserActivityTracker {
  private directusCrud: DirectusCrud;

  constructor() {
    this.directusCrud = new DirectusCrud();
  }

  /**
   * Обновляет время последней активности пользователя
   */
  async updateUserActivity(userId: string, activity?: string): Promise<void> {
    try {
      console.log(`[user-activity] Обновление активности пользователя ${userId}`, activity ? `(${activity})` : '');
      
      const updateData = {
        last_access: new Date().toISOString(),
        ...(activity && { last_activity: activity })
      };

      await this.directusCrud.update('users', userId, updateData);
      
      console.log(`[user-activity] Активность пользователя ${userId} обновлена`);
    } catch (error: any) {
      console.error(`[user-activity] Ошибка при обновлении активности пользователя ${userId}:`, error.message);
    }
  }

  /**
   * Получает статистику активности пользователей
   */
  async getUserActivityStats(days: number = 30): Promise<any> {
    try {
      console.log(`[user-activity] Получение статистики активности за ${days} дней`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const users = await this.directusCrud.readMany('users', {
        fields: ['id', 'email', 'first_name', 'last_name', 'last_access', 'status', 'is_smm_admin', 'expire_date'],
        filter: {
          last_access: {
            _gte: cutoffDate.toISOString()
          }
        },
        sort: ['-last_access']
      });

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const stats = {
        active_users: users.length,
        active_today: users.filter(u => u.last_access && new Date(u.last_access) > oneDayAgo).length,
        active_week: users.filter(u => u.last_access && new Date(u.last_access) > oneWeekAgo).length,
        admins_active: users.filter(u => u.is_smm_admin && u.last_access && new Date(u.last_access) > oneWeekAgo).length,
        expired_but_active: users.filter(u => u.expire_date && new Date(u.expire_date) < now && u.last_access && new Date(u.last_access) > oneWeekAgo).length
      };

      console.log(`[user-activity] Статистика активности:`, stats);
      
      return {
        stats,
        users: users.slice(0, 100) // Ограничиваем до 100 пользователей
      };
    } catch (error: any) {
      console.error('[user-activity] Ошибка при получении статистики активности:', error.message);
      throw error;
    }
  }

  /**
   * Проверяет, истёк ли срок подписки пользователя
   */
  async checkUserSubscription(userId: string): Promise<{ isExpired: boolean; daysLeft: number }> {
    try {
      const user = await this.directusCrud.read('users', userId);
      
      if (!user?.expire_date) {
        return { isExpired: false, daysLeft: -1 }; // Нет даты окончания = безлимитная подписка
      }

      const now = new Date();
      const expireDate = new Date(user.expire_date);
      const timeDiff = expireDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

      return {
        isExpired: daysLeft <= 0,
        daysLeft: Math.max(0, daysLeft)
      };
    } catch (error: any) {
      console.error(`[user-activity] Ошибка при проверке подписки пользователя ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Получает список пользователей с истекающими подписками
   */
  async getExpiringSubscriptions(days: number = 7): Promise<any[]> {
    try {
      console.log(`[user-activity] Поиск подписок, истекающих в течение ${days} дней`);
      
      const now = new Date();
      const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const users = await this.directusCrud.readMany('users', {
        fields: ['id', 'email', 'first_name', 'last_name', 'expire_date', 'last_access'],
        filter: {
          expire_date: {
            _gte: now.toISOString(),
            _lte: futureDate.toISOString()
          },
          status: {
            _neq: 'suspended'
          }
        },
        sort: ['expire_date']
      });

      const result = users.map(user => {
        const expireDate = new Date(user.expire_date);
        const timeDiff = expireDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

        return {
          ...user,
          daysLeft: Math.max(0, daysLeft)
        };
      });

      console.log(`[user-activity] Найдено ${result.length} пользователей с истекающими подписками`);
      
      return result;
    } catch (error: any) {
      console.error('[user-activity] Ошибка при получении истекающих подписок:', error.message);
      throw error;
    }
  }
}

export default UserActivityTracker;