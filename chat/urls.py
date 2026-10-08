from django.urls import path
from . import views


urlpatterns = [

    path("",views.home,name="home"),
    path("api/contacts/",views.contact_list,name="contacts_list"),
    path("api/contacts/add/",views.add_contact,name="add_contact"),
    path("api/contacts/delete/",views.delete_contact,name="delete_contact"),
    path("api/users/search/",views.search_users,name="search_users"),
    path("api/users/<int:user_id>/presence/",views.user_presence,name="user_presence"),
    path("api/messages/<int:user_id>/",views.message_history,name="message_history"),
    path("api/messages/send/",views.send_message,name="send_message"),
    path("api/messages/media/",views.upload_media,name="upload_media"),
    path("api/messages/read/",views.mark_messages_read,name="mark_messages_read"),
    path("api/notifications/",views.notifications,name="notifications"),
]