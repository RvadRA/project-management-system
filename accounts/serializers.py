from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField(read_only=True)
    telegram_chat_id = serializers.CharField(required=False, allow_blank=True)
    notify_telegram = serializers.BooleanField(required=False)
    notify_email = serializers.BooleanField(required=False)
    notify_daily_digest = serializers.BooleanField(required=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'full_name', 'role', 'phone', 'domain', 'avatar',
            'is_active', 'date_joined', 'telegram_chat_id',
            'notify_telegram', 'notify_email', 'notify_daily_digest'
        ]
        read_only_fields = ['date_joined']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Manually fetch from profile
        profile = getattr(instance, 'profile', None)
        if profile:
            ret['telegram_chat_id'] = profile.telegram_chat_id
            ret['notify_telegram'] = profile.notify_telegram
            ret['notify_email'] = profile.notify_email
            ret['notify_daily_digest'] = profile.notify_daily_digest
        else:
            ret['telegram_chat_id'] = ""
            ret['notify_telegram'] = True
            ret['notify_email'] = True
            ret['notify_daily_digest'] = True
        return ret

    def update(self, instance, validated_data):
        telegram_chat_id = validated_data.pop('telegram_chat_id', None)
        notify_telegram = validated_data.pop('notify_telegram', None)
        notify_email = validated_data.pop('notify_email', None)
        notify_daily_digest = validated_data.pop('notify_daily_digest', None)
        
        # Update user fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update profile settings
        from matching.models import EmployeeProfile
        profile, _ = EmployeeProfile.objects.get_or_create(user=instance)
        if telegram_chat_id is not None:
            profile.telegram_chat_id = telegram_chat_id
        if notify_telegram is not None:
            profile.notify_telegram = notify_telegram
        if notify_email is not None:
            profile.notify_email = notify_email
        if notify_daily_digest is not None:
            profile.notify_daily_digest = notify_daily_digest
        profile.save()
            
        return instance


class UserNestedSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'email']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    telegram_chat_id = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'password', 'role', 'phone', 'domain', 'telegram_chat_id',
        ]

    def create(self, validated_data):
        telegram_chat_id = validated_data.pop('telegram_chat_id', None)
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()

        if telegram_chat_id:
            from matching.models import EmployeeProfile
            EmployeeProfile.objects.create(user=user, telegram_chat_id=telegram_chat_id)
            
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])

    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("Old password is incorrect.")
        return value
