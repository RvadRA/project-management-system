import os
import django
from django.core.mail import send_mail
from django.conf import settings

# Set up Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

def send_test_email(recipient):
    print(f"Отправка тестового письма на: {recipient}")
    print(f"Используемый Backend: {settings.EMAIL_BACKEND}")
    
    try:
        send_mail(
            subject='Тестовое уведомление PMS',
            message='Это тестовое сообщение для проверки работы системы уведомлений Project Management System.',
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=False,
        )
        print("Команда на отправку выполнена успешно.")
    except Exception as e:
        print(f"Ошибка при отправке: {str(e)}") 

if __name__ == "__main__":
    send_test_email('kinogold2000@gmail.com')
